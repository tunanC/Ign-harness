use std::process::Command;
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Decode command output: try UTF-8 first, fall back to GBK on garbage.
fn decode(bytes: &[u8]) -> String {
    let utf8 = String::from_utf8_lossy(bytes);
    if utf8.contains('\u{FFFD}') {
        // Invalid UTF-8 → likely GBK (CP936, Chinese Windows)
        let (cow, _, _) = encoding_rs::GBK.decode(bytes);
        return cow.into_owned();
    }
    utf8.into_owned()
}

/// The ONLY tool-execution command in the entire Tauri backend.
/// Client is a dumb pipe: receive a tool_exec payload → Rust 解析 JSON 后自己
/// 判断单命令还是并行组（type=parallel）→ 执行 → 按序组装结果返回。
/// Tool semantics live in server-side capabilities/ — never here.
#[derive(Debug, Serialize)]
struct ExecResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

/// tool_exec 载荷：单命令 {tool, params:{command,cwd}}；并行组 {type:"parallel", items:[{tool, params}]}
#[derive(Deserialize)]
struct ToolExecPayload {
    #[serde(rename = "type")]
    exec_type: Option<String>,
    params: Option<ExecItem>,
    items: Option<Vec<ExecItemEntry>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ExecItem {
    #[serde(default)]
    command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
}

#[derive(Deserialize)]
struct ExecItemEntry {
    tool: String,
    params: Option<ExecItem>,
}

/// 并行组单项结果：tool/params 原样带回 + 执行结果（顺序与 items 对齐）
#[derive(Debug, Serialize)]
struct ParallelItemResult {
    tool: String,
    params: ExecItem,
    result: ExecResult,
}

/// 并行组整体结果：与 server 端 _execute_parallel_tool 的返回格式一致
#[derive(Debug, Serialize)]
struct ParallelOutcome {
    #[serde(rename = "type")]
    kind: String,
    count: usize,
    results: Vec<ParallelItemResult>,
}

/// 返回给前端的执行结果：单命令一个 ExecResult 对象，并行组一个 composite
#[derive(Debug, Serialize)]
#[serde(untagged)]
enum ToolExecOutcome {
    Single(ExecResult),
    Parallel(ParallelOutcome),
}

/// 单条命令执行体（单命令与并行子线程共用）
fn run_command(command: &str, cwd: Option<&str>) -> ExecResult {
    // 用 shlex 拆分命令字符串为 program + args，不做任何包裹
    let parts = match shlex::split(command) {
        Some(v) if !v.is_empty() => v,
        _ => {
            return ExecResult {
                stdout: String::new(),
                stderr: "无法解析命令".into(),
                exit_code: -1,
            };
        }
    };

    let mut cmd = Command::new(&parts[0]);
    if parts.len() > 1 {
        cmd.args(&parts[1..]);
    }

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    match cmd.output() {
        Ok(out) => ExecResult {
            stdout: decode(&out.stdout),
            stderr: decode(&out.stderr),
            exit_code: out.status.code().unwrap_or(-1),
        },
        Err(e) => ExecResult {
            stdout: String::new(),
            stderr: e.to_string(),
            exit_code: -1,
        },
    }
}

#[tauri::command]
async fn shell_exec(payload: ToolExecPayload) -> ToolExecOutcome {
    // async 命令跑在 Tauri 异步运行时（即线程 A，不占 UI 主线程）——
    // wsl 命令跑十几秒也不会卡 ChatPanel。这里解析 payload 决定单/并行。
    if payload.exec_type.as_deref() == Some("parallel") {
        if let Some(items) = payload.items {
            // 并行组：每个命令起一个阻塞子线程并行执行，线程 A 等待全部结果后按 items 顺序组装
            let tasks: Vec<_> = items
                .into_iter()
                .map(|it| {
                    let p = it.params.unwrap_or(ExecItem {
                        command: String::new(),
                        cwd: None,
                    });
                    let tool = it.tool;
                    let command = p.command;
                    let cwd = p.cwd;
                    tauri::async_runtime::spawn_blocking(move || {
                        let result = run_command(&command, cwd.as_deref());
                        ParallelItemResult {
                            tool,
                            params: ExecItem { command, cwd },
                            result,
                        }
                    })
                })
                .collect();
            let mut results = Vec::with_capacity(tasks.len());
            for t in tasks {
                results.push(t.await.unwrap_or_else(|_| ParallelItemResult {
                    tool: String::new(),
                    params: ExecItem {
                        command: String::new(),
                        cwd: None,
                    },
                    result: ExecResult {
                        stdout: String::new(),
                        stderr: "执行线程异常".into(),
                        exit_code: -1,
                    },
                }));
            }
            return ToolExecOutcome::Parallel(ParallelOutcome {
                kind: "parallel".into(),
                count: results.len(),
                results,
            });
        }
    }
    // 单命令
    let p = payload.params.unwrap_or(ExecItem {
        command: String::new(),
        cwd: None,
    });
    let result = tauri::async_runtime::spawn_blocking(move || run_command(&p.command, p.cwd.as_deref()))
        .await
        .unwrap_or_else(|_| ExecResult {
            stdout: String::new(),
            stderr: "执行线程异常".into(),
            exit_code: -1,
        });
    ToolExecOutcome::Single(result)
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![shell_exec, exit_app])
        .on_window_event(|app, event| {
            match event {
                // ── Boundary clamp + restore orb ────────────────
                tauri::WindowEvent::Moved(pos) => {
                    let real_move = pos.x > 0 || pos.y > 0;
                    for (_label, win) in app.webview_windows() {
                        if win.is_minimized().unwrap_or(false) { continue; }
                        if let (Ok(wpos), Ok(Some(m))) = (win.outer_position(), win.current_monitor()) {
                            let ws = win.inner_size().unwrap_or(tauri::PhysicalSize::new(440, 200));
                            let sx = m.position().x as f64;
                            let sy = m.position().y as f64;
                            let sw = m.size().width as f64;
                            let sh = m.size().height as f64;
                            let ww = ws.width as f64;
                            let wh = ws.height as f64;
                            let nx = wpos.x as f64;
                            let ny = wpos.y as f64;
                            let sf = m.scale_factor();
                            let over_l = 30f64 * sf; let over_r = 30f64 * sf;
                            let over_t = 25f64 * sf; let over_b = 100f64 * sf;
                            let mut cx = nx; let mut cy = ny;
                            if cx < sx - over_l { cx = sx - over_l; }
                            if cx + ww > sx + sw + over_r { cx = sx + sw + over_r - ww; }
                            if cy < sy - over_t { cy = sy - over_t; }
                            if cy + wh > sy + sh + over_b { cy = sy + sh + over_b - wh; }
                            if cx != nx || cy != ny {
                                let _ = win.set_position(tauri::PhysicalPosition::new(cx as i32, cy as i32));
                            }
                        }
                    }
                    // Show orb if it was hidden and this is a real restore
                    if real_move {
                        if let Some(orb) = app.get_webview_window("orb") {
                            if !orb.is_minimized().unwrap_or(true) && !orb.is_visible().unwrap_or(true) {
                                let _ = orb.show();
                            }
                        }
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            use tauri::WebviewWindowBuilder;

            // ── Login bootstrap window (entry point, all other windows created by frontend)
            WebviewWindowBuilder::new(
                app,
                "login",
                tauri::WebviewUrl::App("login/index.html".into()),
            )
            .title("Ign — Login")
            .inner_size(480.0, 540.0)
            .min_inner_size(420.0, 480.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .background_color(tauri::webview::Color::from((0u8, 0u8, 0u8, 0u8)))
            .center()
            .build()?;

            // ── System tray ───────────────────────────────────────
            use tauri::menu::{MenuBuilder, MenuItemBuilder};

            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let tray_menu = MenuBuilder::new(app).item(&quit_item).build()?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("no default icon"))
                .tooltip("Ign")
                .show_menu_on_left_click(false)
                .menu(&tray_menu)
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray_handle, event| {
                    if let tauri::tray::TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            let app = tray_handle.app_handle();
                            // Show main if hidden; if visible, leave as-is
                            if let Some(main) = app.get_webview_window("main") {
                                if !main.is_visible().unwrap_or(false) {
                                    let _ = main.show();
                                    let _ = main.set_focus();
                                    // Also restore orb
                                    if let Some(orb) = app.get_webview_window("orb") {
                                        let _ = orb.show();
                                    }
                                }
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, _event| {
            // 退出时不清理 conf/ 目录——settings.json 等配置持久保留
        });
}
