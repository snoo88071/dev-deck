// No console window in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dev_deck_lib::run()
}
