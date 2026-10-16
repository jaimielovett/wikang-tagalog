// Empêche l'ouverture d'une console sous Windows en version finale.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    wikang_tagalog_lib::run()
}
