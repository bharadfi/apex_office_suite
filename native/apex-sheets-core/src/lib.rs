//! JNI bridge between the Kotlin Sheets screen and the IronCalc spreadsheet model.
//! Each open workbook lives in a process-wide table and is addressed by a handle.
//! Rows and columns passed in are 1-based, like the model's own API.

use std::collections::HashMap;
use std::io::Cursor;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Mutex, OnceLock};

use ironcalc::base::types::{Color, HorizontalAlignment};
use ironcalc::base::Model;
use ironcalc::export::save_xlsx_to_writer;
use ironcalc::import::load_from_xlsx_bytes;
use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jboolean, jbyteArray, jdouble, jint, jlong, jstring, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;

const LOCALE: &str = "en";
const TZ: &str = "UTC";
const LANGUAGE: &str = "en";

struct Table {
    next: i64,
    models: HashMap<i64, Model<'static>>,
    /// per workbook: (undo snapshots, redo snapshots)
    history: HashMap<i64, (Vec<Vec<u8>>, Vec<Vec<u8>>)>,
    last_error: String,
}

fn table() -> &'static Mutex<Table> {
    static TABLE: OnceLock<Mutex<Table>> = OnceLock::new();
    TABLE.get_or_init(|| {
        Mutex::new(Table { next: 1, models: HashMap::new(), history: HashMap::new(), last_error: String::new() })
    })
}

fn insert(model: Model<'static>) -> i64 {
    let mut t = table().lock().unwrap();
    let id = t.next;
    t.next += 1;
    t.models.insert(id, model);
    id
}

fn set_error(message: String) {
    table().lock().unwrap().last_error = message;
}

fn with_model<R>(handle: i64, f: impl FnOnce(&mut Model<'static>) -> R) -> Option<R> {
    let mut t = table().lock().unwrap();
    let result = catch_unwind(AssertUnwindSafe(|| t.models.get_mut(&handle).map(f)));
    match result {
        Ok(None) => {
            t.last_error = format!("no workbook for handle {handle}");
            None
        }
        Ok(r) => r,
        Err(payload) => {
            let detail = payload
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_default();
            t.last_error = format!("The spreadsheet engine hit an unexpected error: {detail}");
            None
        }
    }
}

fn new_jstring(env: &mut JNIEnv, s: &str) -> jstring {
    env.new_string(s).map(|j| j.into_raw()).unwrap_or(std::ptr::null_mut())
}

fn rgb(color: &Color) -> String {
    match color {
        Color::Rgb(s) => s.clone(),
        _ => String::new(),
    }
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeOpen(
    env: JNIEnv,
    _class: JClass,
    bytes: JByteArray,
) -> jlong {
    let data = match env.convert_byte_array(&bytes) {
        Ok(d) => d,
        Err(e) => {
            set_error(format!("Could not read the file: {e}"));
            return 0;
        }
    };
    let loaded = catch_unwind(AssertUnwindSafe(|| {
        load_from_xlsx_bytes(&data, "workbook", LOCALE, TZ)
            .map_err(|e| e.to_string())
            .and_then(|wb| Model::from_workbook(wb, LANGUAGE))
    }));
    match loaded {
        Ok(Ok(mut model)) => {
            model.evaluate();
            insert(model)
        }
        Ok(Err(e)) => {
            set_error(e);
            0
        }
        Err(_) => {
            set_error("This workbook could not be read.".into());
            0
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeNew(
    _env: JNIEnv,
    _class: JClass,
) -> jlong {
    match Model::new_empty("workbook", LOCALE, TZ, LANGUAGE) {
        Ok(m) => insert(m),
        Err(e) => {
            set_error(e);
            0
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeLastError(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    let message = table().lock().unwrap().last_error.clone();
    new_jstring(&mut env, &message)
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeClose(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    let mut t = table().lock().unwrap();
    t.models.remove(&handle);
    t.history.remove(&handle);
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeSheetNames(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    let names = with_model(handle, |m| m.workbook.get_worksheet_names().join("\n")).unwrap_or_default();
    new_jstring(&mut env, &names)
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeAddSheet(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    name: JString,
) -> jboolean {
    let name: String = match env.get_string(&name) {
        Ok(s) => s.into(),
        Err(_) => return JNI_FALSE,
    };
    match with_model(handle, |m| m.add_sheet(&name)) {
        Some(Ok(())) => JNI_TRUE,
        Some(Err(e)) => {
            set_error(e);
            JNI_FALSE
        }
        None => JNI_FALSE,
    }
}

/// "rows,columns" of the used area (at least 1,1).
#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeDimension(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    sheet: jint,
) -> jstring {
    let text = with_model(handle, |m| {
        m.workbook
            .worksheet(sheet as u32)
            .map(|ws| {
                let d = ws.dimension();
                format!("{},{}", d.max_row.max(1), d.max_column.max(1))
            })
            .unwrap_or_else(|_| "1,1".into())
    })
    .unwrap_or_else(|| "1,1".into());
    new_jstring(&mut env, &text)
}

/// Cells of a block, rows split by U+001E, cells by U+001F:
/// text, flags (1 bold, 2 italic, 4 underline), fill #RRGGBB, font #RRGGBB, align (L/C/R/"").
#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeRange(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    sheet: jint,
    row0: jint,
    col0: jint,
    row1: jint,
    col1: jint,
) -> jstring {
    let text = with_model(handle, |m| {
        let mut rows = Vec::new();
        for r in row0..=row1 {
            let mut cells = Vec::new();
            for c in col0..=col1 {
                let value = m.get_formatted_cell_value(sheet as u32, r, c).unwrap_or_default();
                let (flags, fill, font, align) = match m.get_style_for_cell(sheet as u32, r, c) {
                    Ok(s) => {
                        let flags = (s.font.b as u8) | ((s.font.i as u8) << 1) | ((s.font.u as u8) << 2);
                        let align = match s.alignment.as_ref().map(|a| &a.horizontal) {
                            Some(HorizontalAlignment::Left) => "L",
                            Some(HorizontalAlignment::Center) | Some(HorizontalAlignment::CenterContinuous) => "C",
                            Some(HorizontalAlignment::Right) => "R",
                            _ => "",
                        };
                        (flags, rgb(&s.fill.color), rgb(&s.font.color), align)
                    }
                    Err(_) => (0, String::new(), String::new(), ""),
                };
                cells.push(format!("{value}\u{1f}{flags}\u{1f}{fill}\u{1f}{font}\u{1f}{align}"));
            }
            rows.push(cells.join("\u{1e}\u{1d}"));
        }
        rows.join("\u{1c}")
    })
    .unwrap_or_else(|| "#NOMODEL".to_string());
    new_jstring(&mut env, &text)
}

/// What the formula bar shows: the formula for a formula cell, otherwise the entered value.
#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeInput(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    sheet: jint,
    row: jint,
    col: jint,
) -> jstring {
    let text = with_model(handle, |m| {
        m.get_localized_cell_content(sheet as u32, row, col).unwrap_or_else(|e| format!("#ERR {e}"))
    })
    .unwrap_or_default();
    new_jstring(&mut env, &text)
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeSetInput(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    sheet: jint,
    row: jint,
    col: jint,
    text: JString,
) -> jboolean {
    let text: String = match env.get_string(&text) {
        Ok(s) => s.into(),
        Err(_) => return JNI_FALSE,
    };
    let result = with_model(handle, |m| {
        let r = m.set_user_input(sheet as u32, row, col, text);
        if r.is_ok() {
            m.evaluate();
        }
        r
    });
    match result {
        Some(Ok(())) => JNI_TRUE,
        Some(Err(e)) => {
            set_error(e);
            JNI_FALSE
        }
        None => JNI_FALSE,
    }
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeColumnWidth(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    sheet: jint,
    col: jint,
) -> jdouble {
    with_model(handle, |m| m.get_column_width(sheet as u32, col).unwrap_or(100.0)).unwrap_or(100.0)
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeRowHeight(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    sheet: jint,
    row: jint,
) -> jdouble {
    with_model(handle, |m| m.get_row_height(sheet as u32, row).unwrap_or(28.0)).unwrap_or(28.0)
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeSave(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jbyteArray {
    let bytes = with_model(handle, |m| {
        save_xlsx_to_writer(m, Cursor::new(Vec::new())).map(|c| c.into_inner())
    });
    match bytes {
        Some(Ok(b)) => env.byte_array_from_slice(&b).map(|a| a.into_raw()).unwrap_or(std::ptr::null_mut()),
        Some(Err(e)) => {
            set_error(e.to_string());
            std::ptr::null_mut()
        }
        None => std::ptr::null_mut(),
    }
}

/// Structural edits: 0 insert rows, 1 delete rows, 2 insert columns, 3 delete columns.
#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeEdit(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    sheet: jint,
    op: jint,
    index: jint,
    count: jint,
) -> jboolean {
    let result = with_model(handle, |m| {
        let r = match op {
            0 => m.insert_rows(sheet as u32, index, count),
            1 => m.delete_rows(sheet as u32, index, count),
            2 => m.insert_columns(sheet as u32, index, count),
            3 => m.delete_columns(sheet as u32, index, count),
            _ => Err("unknown edit".to_string()),
        };
        if r.is_ok() {
            m.evaluate();
        }
        r
    });
    match result {
        Some(Ok(())) => JNI_TRUE,
        Some(Err(e)) => {
            set_error(e);
            JNI_FALSE
        }
        None => JNI_FALSE,
    }
}

const HISTORY_LIMIT: usize = 30;

/// Remember the workbook as it is now, so the next edit can be undone.
#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeSnapshot(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    let mut t = table().lock().unwrap();
    let bytes = match t.models.get(&handle) {
        Some(m) => m.to_bytes(),
        None => return,
    };
    let (undo, redo) = t.history.entry(handle).or_default();
    undo.push(bytes);
    if undo.len() > HISTORY_LIMIT {
        undo.remove(0);
    }
    redo.clear();
}

fn step_history(handle: i64, undo: bool) -> bool {
    let mut t = table().lock().unwrap();
    let current = match t.models.get(&handle) {
        Some(m) => m.to_bytes(),
        None => return false,
    };
    let target = {
        let (u, r) = t.history.entry(handle).or_default();
        let (from, to) = if undo { (u, r) } else { (r, u) };
        match from.pop() {
            Some(bytes) => {
                to.push(current);
                bytes
            }
            None => return false,
        }
    };
    match Model::from_bytes(&target, LANGUAGE) {
        Ok(mut m) => {
            m.evaluate();
            t.models.insert(handle, m);
            true
        }
        Err(e) => {
            t.last_error = e;
            false
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeUndo(_env: JNIEnv, _class: JClass, handle: jlong) -> jboolean {
    if step_history(handle, true) { JNI_TRUE } else { JNI_FALSE }
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeRedo(_env: JNIEnv, _class: JClass, handle: jlong) -> jboolean {
    if step_history(handle, false) { JNI_TRUE } else { JNI_FALSE }
}

/// prop: 0 toggle bold, 1 toggle italic, 2 fill colour (0xRRGGBB, -1 none),
/// 3 font colour (0xRRGGBB, -1 default), 4 alignment (0 general, 1 left, 2 centre, 3 right),
/// 5 number format (0 general, 1 number, 2 percent, 3 currency, 4 date, 5 two decimals)
#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeStyle(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    sheet: jint,
    row: jint,
    col: jint,
    prop: jint,
    value: jint,
) -> jboolean {
    use ironcalc::base::types::{Alignment, Color as C, HorizontalAlignment as H};
    let result = with_model(handle, |m| {
        let mut style = m.get_style_for_cell(sheet as u32, row, col)?;
        let color = |v: i32| if v < 0 { C::None } else { C::Rgb(format!("#{:06X}", v & 0xFFFFFF)) };
        match prop {
            0 => style.font.b = !style.font.b,
            1 => style.font.i = !style.font.i,
            2 => style.fill.color = color(value),
            3 => style.font.color = color(value),
            4 => {
                let h = match value { 1 => H::Left, 2 => H::Center, 3 => H::Right, _ => H::General };
                let mut a = style.alignment.clone().unwrap_or_else(|| Alignment {
                    horizontal: H::General,
                    vertical: Default::default(),
                    wrap_text: false,
                });
                a.horizontal = h;
                style.alignment = Some(a);
            }
            5 => {
                const FORMATS: [&str; 6] = ["general", "#,##0.00", "0%", "$#,##0.00", "yyyy-mm-dd", "0.00"];
                style.num_fmt = FORMATS.get(value as usize).copied().unwrap_or("general").to_string();
            }
            _ => return Err("unknown style property".to_string()),
        }
        m.set_cell_style(sheet as u32, row, col, &style)
    });
    match result {
        Some(Ok(())) => JNI_TRUE,
        Some(Err(e)) => {
            set_error(e);
            JNI_FALSE
        }
        None => JNI_FALSE,
    }
}

#[no_mangle]
pub extern "system" fn Java_com_apexoffice_android_sheets_NativeSheets_nativeSetColumnWidth(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    sheet: jint,
    col: jint,
    width: jdouble,
) -> jboolean {
    match with_model(handle, |m| m.set_column_width(sheet as u32, col, width)) {
        Some(Ok(())) => JNI_TRUE,
        Some(Err(e)) => {
            set_error(e);
            JNI_FALSE
        }
        None => JNI_FALSE,
    }
}
