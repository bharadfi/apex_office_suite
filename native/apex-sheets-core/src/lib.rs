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
    last_error: String,
}

fn table() -> &'static Mutex<Table> {
    static TABLE: OnceLock<Mutex<Table>> = OnceLock::new();
    TABLE.get_or_init(|| {
        Mutex::new(Table { next: 1, models: HashMap::new(), last_error: String::new() })
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
    table().lock().unwrap().models.remove(&handle);
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
