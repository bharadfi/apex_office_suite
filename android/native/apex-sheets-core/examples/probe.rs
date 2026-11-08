use ironcalc::base::Model;
use ironcalc::import::load_from_xlsx_bytes;
fn main() {
    let path = std::env::args().nth(1).unwrap();
    let bytes = std::fs::read(path).unwrap();
    let wb = load_from_xlsx_bytes(&bytes, "workbook", "en", "UTC").unwrap();
    let mut m = Model::from_workbook(wb, "en").unwrap();
    m.evaluate();
    println!("names {:?}", m.workbook.get_worksheet_names());
    let d = m.workbook.worksheet(0).unwrap().dimension();
    println!("dim {:?}", (d.min_row, d.max_row, d.min_column, d.max_column));
    for r in 1..=5 { for c in 1..=2 {
        println!("{r},{c} fmt={:?} content={:?} style_b={:?}", m.get_formatted_cell_value(0, r, c), m.get_localized_cell_content(0, r, c), m.get_style_for_cell(0, r, c).map(|s| (s.font.b, s.fill.color))); } }
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut n = 0;
        for r in 1..=64 { for c in 1..=16 {
            let _ = m.get_formatted_cell_value(0, r, c);
            let _ = m.get_style_for_cell(0, r, c);
            n += 1;
        } }
        n
    }));
    println!("wide scan: {:?}", r.is_ok());
}
