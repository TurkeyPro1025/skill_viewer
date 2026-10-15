// 桌面版入口。release 下不弹控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    skill_viewer_desktop::run()
}
