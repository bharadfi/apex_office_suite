//! Apex Office's thumbnail handler for Windows Explorer (`IThumbnailProvider`).
//!
//! Explorer hands this library a document as a stream. The library does not read the document: it
//! works out what kind of file it is from its first bytes, writes it to a temporary file and runs
//! the program's own command line (`Apex Office.exe resources/cli/apexoffice.cjs render <file> --page 1`)
//! from the folder it is installed in, waits for it with a time limit, and turns the first page it
//! drew into the bitmap Explorer asked for, with a small Apex Office badge in the bottom right
//! corner. A damaged or hostile file can therefore only ever stop that child process. A file the
//! program cannot draw (a password-protected or very old one) gets the Apex Office tile instead of a page.
//!
//! The installer registers the handler for `.docx .xlsx .xlsm .pptx .pdf .md .markdown .html .htm`.
//! It is the only code in the project that uses `unsafe`: COM cannot be written without it.
#![cfg(windows)]
// The COM entry points are exported on purpose (Explorer finds them by name).
#![allow(linker_messages)]

use std::cell::RefCell;
use std::ffi::c_void;
use std::os::windows::process::CommandExt as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_INVALIDARG, E_OUTOFMEMORY, E_UNEXPECTED, HMODULE, S_FALSE,
};
use windows::Win32::Graphics::Gdi::{BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateDIBSection, DIB_RGB_COLORS, HBITMAP};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl, IStream};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithStream, IInitializeWithStream_Impl};
use windows::Win32::UI::Shell::{IThumbnailProvider, IThumbnailProvider_Impl, WTS_ALPHATYPE, WTSAT_ARGB};
use windows::core::{BOOL, GUID, HRESULT, IUnknown, Interface as _, Ref, Result, implement};

/// The handler's class id. The installer registers this same value (`apps/shell/build/installer.nsh`).
const CLSID_APEX_THUMBNAIL: GUID = GUID::from_u128(0x6F3A2B9E_5D14_4E0B_8C7A_1B2D9E4F7A30);
const EXE_NAME: &str = "Apex Office.exe";
const CLI_RELATIVE: &str = "resources\\cli\\apexoffice.cjs";
/// A file larger than this gets no page (the app refuses it as well).
const MAX_FILE_BYTES: usize = 256 * 1024 * 1024;
/// The child gets this long; a slow or stuck file then shows the tile.
const CHILD_TIMEOUT: Duration = Duration::from_secs(40);
/// `CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS`: a background job for a folder full of documents.
const CHILD_FLAGS: u32 = 0x0800_0000 | 0x0000_4000;

static BADGE_PNG: &[u8] = include_bytes!("../assets/badge.png");
static TILE_PNG: &[u8] = include_bytes!("../assets/tile.png");

static MODULE: AtomicIsize = AtomicIsize::new(0);
static SEQUENCE: AtomicU32 = AtomicU32::new(0);

#[unsafe(no_mangle)]
extern "system" fn DllMain(module: HMODULE, reason: u32, _reserved: *mut c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH {
        MODULE.store(module.0 as isize, Ordering::Relaxed);
    }
    BOOL(1)
}

/// Explorer asks for the class factory of [`CLSID_APEX_THUMBNAIL`].
#[unsafe(no_mangle)]
unsafe extern "system" fn DllGetClassObject(clsid: *const GUID, iid: *const GUID, object: *mut c_void) -> HRESULT {
    if clsid.is_null() || iid.is_null() || object.is_null() {
        return E_INVALIDARG;
    }
    // SAFETY: COM passes valid pointers for the duration of the call (checked non-null above).
    unsafe {
        if *clsid != CLSID_APEX_THUMBNAIL {
            return CLASS_E_CLASSNOTAVAILABLE;
        }
        let factory: IClassFactory = Factory.into();
        factory.query(iid, object.cast())
    }
}

/// The library stays loaded while its host process runs (a thumbnail host is short-lived).
#[unsafe(no_mangle)]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_FALSE
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<'_, IUnknown>, iid: *const GUID, object: *mut *mut c_void) -> Result<()> {
        if outer.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        if iid.is_null() || object.is_null() {
            return Err(E_INVALIDARG.into());
        }
        let provider: IUnknown = Provider::default().into();
        // SAFETY: `iid` and `object` are COM's out parameters, checked non-null above.
        unsafe { provider.query(iid, object.cast()).ok() }
    }

    fn LockServer(&self, _lock: BOOL) -> Result<()> {
        Ok(())
    }
}

#[implement(IInitializeWithStream, IThumbnailProvider)]
#[derive(Default)]
struct Provider {
    stream: RefCell<Option<IStream>>,
}

impl IInitializeWithStream_Impl for Provider_Impl {
    fn Initialize(&self, stream: Ref<'_, IStream>, _mode: u32) -> Result<()> {
        *self.stream.borrow_mut() = Some(stream.ok()?.clone());
        Ok(())
    }
}

impl IThumbnailProvider_Impl for Provider_Impl {
    fn GetThumbnail(&self, size: u32, bitmap: *mut HBITMAP, alpha: *mut WTS_ALPHATYPE) -> Result<()> {
        if bitmap.is_null() || alpha.is_null() {
            return Err(E_INVALIDARG.into());
        }
        let stream = self.stream.borrow().clone().ok_or_else(|| windows::core::Error::from(E_UNEXPECTED))?;
        let data = read_stream(&stream)?;
        let size = size.clamp(16, 1024);
        // A panic must never take the host down: whatever goes wrong, the tile is a fine answer.
        let picture = std::panic::catch_unwind(|| thumbnail(&data, size)).unwrap_or_else(|_| tile(size));
        let handle = make_bitmap(&picture)?;
        // SAFETY: Explorer's out parameters, checked non-null above.
        unsafe {
            *bitmap = handle;
            *alpha = WTSAT_ARGB;
        }
        Ok(())
    }
}

/// A picture: size and premultiplied BGRA pixels, top row first.
struct Picture {
    width: u32,
    height: u32,
    bgra: Vec<u8>,
}

fn read_stream(stream: &IStream) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    let mut chunk = vec![0u8; 1 << 20];
    loop {
        let mut read = 0u32;
        // SAFETY: `chunk` is a valid buffer of the length given, and `read` outlives the call.
        unsafe { stream.Read(chunk.as_mut_ptr().cast(), chunk.len() as u32, Some(&mut read)).ok()? };
        if read == 0 {
            return Ok(data);
        }
        data.extend_from_slice(&chunk[..read as usize]);
        if data.len() > MAX_FILE_BYTES {
            return Err(E_OUTOFMEMORY.into());
        }
    }
}

/// What the file is, from its first bytes: the extension the render command needs. None for
/// anything this library should not try to draw (old binary formats, encrypted packages).
fn sniff(data: &[u8]) -> Option<&'static str> {
    let head = &data[..data.len().min(1024)];
    if find(head, b"%PDF-").is_some() {
        return Some("pdf");
    }
    if data.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) {
        // an old binary Office file, or an encrypted OOXML package
        return None;
    }
    if data.starts_with(b"PK\x03\x04") {
        for (marker, ext) in [
            (&b"word/document.xml"[..], "docx"),
            (&b"xl/workbook.xml"[..], "xlsx"),
            (&b"ppt/presentation.xml"[..], "pptx"),
        ] {
            if find(data, marker).is_some() {
                return Some(ext);
            }
        }
        return None;
    }
    // text: HTML or Markdown
    let text = String::from_utf8_lossy(&data[..data.len().min(4096)]).to_ascii_lowercase();
    if data.iter().take(4096).any(|b| *b == 0) {
        return None;
    }
    if text.contains("<!doctype html") || text.contains("<html") || text.contains("<body") {
        return Some("html");
    }
    Some("md")
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    let first = needle[0];
    let last_start = haystack.len() - needle.len();
    let mut i = 0;
    while i <= last_start {
        match haystack[i..=last_start].iter().position(|b| *b == first) {
            None => return None,
            Some(offset) => {
                i += offset;
                if &haystack[i..i + needle.len()] == needle {
                    return Some(i);
                }
                i += 1;
            }
        }
    }
    None
}

/// Removes the temporary files when dropped, whichever way the call ends.
struct Temp(Vec<PathBuf>);

impl Drop for Temp {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = std::fs::remove_file(path);
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

/// The folder this library is installed in: the program and `resources\cli` sit beside it.
fn install_dir() -> Option<PathBuf> {
    let mut buffer = [0u16; 1024];
    // SAFETY: `buffer` is valid for the length given; the handle is this library's own.
    let length = unsafe { GetModuleFileNameW(Some(HMODULE(MODULE.load(Ordering::Relaxed) as *mut c_void)), &mut buffer) } as usize;
    if length == 0 || length >= buffer.len() {
        return None;
    }
    let dll = PathBuf::from(String::from_utf16(&buffer[..length]).ok()?);
    Some(dll.parent()?.to_path_buf())
}

fn thumbnail(data: &[u8], size: u32) -> Picture {
    match page_for(data, size) {
        Ok(picture) => picture,
        Err(_) => tile(size),
    }
}

fn page_for(data: &[u8], size: u32) -> std::result::Result<Picture, String> {
    let ext = sniff(data).ok_or("not a file this library draws")?;
    let root = install_dir().ok_or("no install folder")?;
    let exe = root.join(EXE_NAME);
    let cli = root.join(CLI_RELATIVE);
    if !exe.is_file() || !cli.is_file() {
        return Err("the program is not beside the library".into());
    }
    let dir = std::env::temp_dir();
    let tag = format!("apex-thumb-{}-{}", std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed));
    let input = dir.join(format!("{tag}.{ext}"));
    let out_dir = dir.join(format!("{tag}-out"));
    let _cleanup = Temp(vec![input.clone(), out_dir.clone()]);
    std::fs::write(&input, data).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    run_child(&exe, &cli, &input, &out_dir, render_scale(size))?;
    let png_path = std::fs::read_dir(&out_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .find(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("png")))
        .ok_or("the program drew no page")?;
    let (width, height, rgba) = decode_png(&std::fs::read(png_path).map_err(|e| e.to_string())?)?;
    Ok(compose(&rgba, width, height, size))
}

/// The scale to ask the render command for: pages come out a little larger than the thumbnail.
fn render_scale(size: u32) -> f32 {
    (size as f32 / 600.0).clamp(0.3, 2.0)
}

fn run_child(exe: &Path, cli: &Path, input: &Path, out_dir: &Path, scale: f32) -> std::result::Result<(), String> {
    let mut child = Command::new(exe)
        .arg(cli)
        .arg("render")
        .arg(input)
        .arg("--out")
        .arg(out_dir)
        .arg("--page")
        .arg("1")
        .arg("--scale")
        .arg(format!("{scale:.2}"))
        .env("ELECTRON_RUN_AS_NODE", "1")
        .creation_flags(CHILD_FLAGS)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => return Err(format!("the render exited with {status}")),
            None if started.elapsed() > CHILD_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("timed out".into());
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

/// A PNG as 8-bit RGBA.
fn decode_png(bytes: &[u8]) -> std::result::Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; reader.output_buffer_size().ok_or("too large")?];
    let info = reader.next_frame(&mut buffer).map_err(|e| e.to_string())?;
    let (width, height) = (info.width, info.height);
    if width == 0 || height == 0 || width > 8192 || height > 8192 {
        return Err(format!("picture of {width} x {height}"));
    }
    let pixels = &buffer[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => pixels.to_vec(),
        png::ColorType::Rgb => pixels.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => pixels.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        png::ColorType::Grayscale => pixels.iter().flat_map(|g| [*g, *g, *g, 255]).collect(),
        png::ColorType::Indexed => return Err("an indexed picture was not expanded".into()),
    };
    if rgba.len() != width as usize * height as usize * 4 {
        return Err("the picture is truncated".into());
    }
    Ok((width, height, rgba))
}

/// `src` resized to `dw` x `dh`: pixels are averaged over the source area they cover (box filter) when
/// shrinking and blended between neighbours when enlarging.
fn resize(src: &[u8], sw: u32, sh: u32, dw: u32, dh: u32) -> Vec<u8> {
    let mut out = vec![0u8; dw as usize * dh as usize * 4];
    let (sw_f, sh_f) = (sw as f32, sh as f32);
    for y in 0..dh {
        let y0 = y as f32 * sh_f / dh as f32;
        let y1 = ((y + 1) as f32 * sh_f / dh as f32).max(y0 + 1e-3);
        for x in 0..dw {
            let x0 = x as f32 * sw_f / dw as f32;
            let x1 = ((x + 1) as f32 * sw_f / dw as f32).max(x0 + 1e-3);
            let mut acc = [0f32; 4];
            let mut weight = 0f32;
            let (iy0, iy1) = (y0.floor() as u32, (y1.ceil() as u32).min(sh));
            let (ix0, ix1) = (x0.floor() as u32, (x1.ceil() as u32).min(sw));
            for sy in iy0..iy1.max(iy0 + 1) {
                let wy = (y1.min(sy as f32 + 1.0) - y0.max(sy as f32)).max(0.0);
                for sx in ix0..ix1.max(ix0 + 1) {
                    let wx = (x1.min(sx as f32 + 1.0) - x0.max(sx as f32)).max(0.0);
                    let w = wx * wy;
                    let i = (sy.min(sh - 1) as usize * sw as usize + sx.min(sw - 1) as usize) * 4;
                    let a = src[i + 3] as f32 / 255.0;
                    // average premultiplied colour so a transparent pixel does not tint its neighbours
                    acc[0] += src[i] as f32 * a * w;
                    acc[1] += src[i + 1] as f32 * a * w;
                    acc[2] += src[i + 2] as f32 * a * w;
                    acc[3] += a * w;
                    weight += w;
                }
            }
            let o = (y as usize * dw as usize + x as usize) * 4;
            if weight > 0.0 && acc[3] > 0.0 {
                out[o] = (acc[0] / acc[3]).round().clamp(0.0, 255.0) as u8;
                out[o + 1] = (acc[1] / acc[3]).round().clamp(0.0, 255.0) as u8;
                out[o + 2] = (acc[2] / acc[3]).round().clamp(0.0, 255.0) as u8;
                out[o + 3] = (acc[3] / weight * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// The size a `w` x `h` picture takes when it fits inside a `size` square (never enlarged past it).
fn fit(w: u32, h: u32, size: u32) -> (u32, u32) {
    let scale = (size as f32 / w as f32).min(size as f32 / h as f32);
    (((w as f32 * scale).round() as u32).max(1), ((h as f32 * scale).round() as u32).max(1))
}

/// Draws `top` (straight RGBA) over `base` (straight RGBA) with its top left at (`x`, `y`).
fn blend(base: &mut [u8], bw: u32, bh: u32, top: &[u8], tw: u32, th: u32, x: i64, y: i64) {
    for ty in 0..th as i64 {
        for tx in 0..tw as i64 {
            let (px, py) = (x + tx, y + ty);
            if px < 0 || py < 0 || px >= bw as i64 || py >= bh as i64 {
                continue;
            }
            let t = (ty as usize * tw as usize + tx as usize) * 4;
            let b = (py as usize * bw as usize + px as usize) * 4;
            let a = top[t + 3] as f32 / 255.0;
            if a <= 0.0 {
                continue;
            }
            let ba = base[b + 3] as f32 / 255.0;
            let out_a = a + ba * (1.0 - a);
            for c in 0..3 {
                let v = (top[t + c] as f32 * a + base[b + c] as f32 * ba * (1.0 - a)) / out_a;
                base[b + c] = v.round().clamp(0.0, 255.0) as u8;
            }
            base[b + 3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
}

/// The page, shrunk to fit and laid over white, with the badge in its bottom right corner.
fn compose(page: &[u8], width: u32, height: u32, size: u32) -> Picture {
    let (w, h) = fit(width, height, size);
    let mut rgba = resize(page, width, height, w, h);
    // flatten onto white: a page has no transparent parts
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3] as f32 / 255.0;
        for c in 0..3 {
            px[c] = (px[c] as f32 * a + 255.0 * (1.0 - a)).round() as u8;
        }
        px[3] = 255;
    }
    if let Ok((bw, bh, badge)) = decode_png(BADGE_PNG) {
        let side = ((w.min(h) as f32 * 0.30).round() as u32).clamp(14, 192);
        let badge = resize(&badge, bw, bh, side, side * bh / bw.max(1));
        let margin = (side as f32 * 0.12).round() as i64;
        let bh2 = side * bh / bw.max(1);
        blend(&mut rgba, w, h, &badge, side, bh2, w as i64 - side as i64 - margin, h as i64 - bh2 as i64 - margin);
    }
    Picture { width: w, height: h, bgra: to_bgra_premultiplied(&rgba) }
}

/// The Apex Office tile, for a file that cannot be drawn.
fn tile(size: u32) -> Picture {
    match decode_png(TILE_PNG) {
        Ok((w, h, rgba)) => {
            let side = size.min(256).max(16);
            let _ = (w, h);
            let resized = resize(&rgba, w, h, side, side);
            Picture { width: side, height: side, bgra: to_bgra_premultiplied(&resized) }
        }
        Err(_) => Picture { width: 1, height: 1, bgra: vec![255, 255, 255, 255] },
    }
}

fn to_bgra_premultiplied(rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgba.len());
    for px in rgba.chunks_exact(4) {
        let a = px[3] as u32;
        let premul = |c: u8| ((c as u32 * a + 127) / 255) as u8;
        out.extend_from_slice(&[premul(px[2]), premul(px[1]), premul(px[0]), px[3]]);
    }
    out
}

fn make_bitmap(picture: &Picture) -> Result<HBITMAP> {
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: picture.width as i32,
            // Negative: top row first, as the picture is stored.
            biHeight: -(picture.height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = std::ptr::null_mut();
    // SAFETY: `info` describes a 32-bit top-down bitmap; `bits` receives the pixel buffer GDI owns.
    let bitmap = unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)? };
    if bits.is_null() {
        return Err(E_OUTOFMEMORY.into());
    }
    // SAFETY: the section holds exactly `width * height * 4` bytes, which is `picture.bgra.len()`.
    unsafe { std::ptr::copy_nonoverlapping(picture.bgra.as_ptr(), bits.cast::<u8>(), picture.bgra.len()) };
    Ok(bitmap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_tells_the_kinds_of_file_apart() {
        assert_eq!(sniff(b"%PDF-1.7\n..."), Some("pdf"));
        let mut docx = b"PK\x03\x04....".to_vec();
        docx.extend_from_slice(b"word/document.xml");
        assert_eq!(sniff(&docx), Some("docx"));
        let mut xlsx = b"PK\x03\x04....".to_vec();
        xlsx.extend_from_slice(b"xl/workbook.xml");
        assert_eq!(sniff(&xlsx), Some("xlsx"));
        let mut pptx = b"PK\x03\x04....".to_vec();
        pptx.extend_from_slice(b"ppt/presentation.xml");
        assert_eq!(sniff(&pptx), Some("pptx"));
        assert_eq!(sniff(b"<!DOCTYPE html><html></html>"), Some("html"));
        assert_eq!(sniff(b"# A heading\n\ntext"), Some("md"));
    }

    #[test]
    fn it_refuses_what_it_cannot_draw() {
        assert_eq!(sniff(&[0xD0, 0xCF, 0x11, 0xE0, 0, 0]), None, "old binary or encrypted Office file");
        assert_eq!(sniff(b"PK\x03\x04 a zip that is no Office file"), None);
        assert_eq!(sniff(&[0, 1, 2, 3, 4]), None, "binary");
    }

    #[test]
    fn find_locates_a_marker_anywhere() {
        assert_eq!(find(b"abcxyz", b"xyz"), Some(3));
        assert_eq!(find(b"abc", b"abcd"), None);
        assert_eq!(find(b"aaab", b"aab"), Some(1));
    }

    #[test]
    fn a_picture_fits_inside_the_square_keeping_its_shape() {
        assert_eq!(fit(1000, 500, 256), (256, 128));
        assert_eq!(fit(500, 1000, 256), (128, 256));
        assert_eq!(fit(100, 100, 256), (256, 256));
    }

    #[test]
    fn resizing_keeps_a_flat_colour_and_its_opacity() {
        let src = vec![10u8, 20, 30, 255].repeat(16);
        let out = resize(&src, 4, 4, 2, 2);
        assert_eq!(&out[..4], &[10, 20, 30, 255]);
    }

    #[test]
    fn a_page_gets_the_badge_in_its_corner_and_stays_opaque() {
        let page = vec![255u8; 100 * 140 * 4];
        let picture = compose(&page, 100, 140, 128);
        assert_eq!((picture.width, picture.height), (91, 128));
        assert!(picture.bgra.chunks_exact(4).all(|p| p[3] == 255));
        // the corner differs from the plain white page
        let last = &picture.bgra[picture.bgra.len() - 4 * (picture.width as usize * 12 + 12)..][..4];
        assert!(last.iter().take(3).any(|c| *c != 255), "the badge covers the corner");
    }

    #[test]
    fn the_tile_is_a_square_picture() {
        let picture = tile(96);
        assert_eq!((picture.width, picture.height), (96, 96));
        assert_eq!(picture.bgra.len(), 96 * 96 * 4);
    }

    #[test]
    fn the_bitmap_holds_the_pixels() {
        let picture = Picture { width: 2, height: 1, bgra: vec![1, 2, 3, 255, 4, 5, 6, 255] };
        let handle = make_bitmap(&picture).unwrap();
        assert!(!handle.is_invalid());
    }

    #[test]
    fn the_render_scale_grows_with_the_requested_size() {
        assert!(render_scale(256) < render_scale(1024));
        assert!(render_scale(16) >= 0.3 && render_scale(5000) <= 2.0);
    }
}
