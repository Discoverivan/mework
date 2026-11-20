use std::{
    collections::HashMap,
    ptr,
    sync::{Arc, Mutex, OnceLock, Weak},
};

use tauri::{Runtime, WebviewWindow, WindowEvent};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, WPARAM},
    System::Threading::GetCurrentThreadId,
    UI::WindowsAndMessaging::{
        CopyIcon, DestroyIcon, GetWindowThreadProcessId, SendMessageW, HICON, ICON_BIG, ICON_SMALL,
        WM_GETICON, WM_SETICON,
    },
};

// The registry deduplicates listeners without extending a window's icon lifetime.
type IconRegistry = Mutex<HashMap<usize, Weak<Mutex<WindowIcon>>>>;
static WINDOW_ICONS: OnceLock<IconRegistry> = OnceLock::new();

struct OwnedIcon(usize);

impl Drop for OwnedIcon {
    fn drop(&mut self) {
        // Only CopyIcon handles created here are owned; Tao's handles are never destroyed.
        unsafe { DestroyIcon(self.0 as HICON) };
    }
}

#[derive(Default)]
struct WindowIcon {
    current: Option<OwnedIcon>,
    destroyed: bool,
}

fn release_icon(state: &Mutex<WindowIcon>) {
    let mut state = state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.destroyed = true;
    drop(state.current.take());
}

fn icon_state<R: Runtime>(window: &WebviewWindow<R>) -> Result<Arc<Mutex<WindowIcon>>, String> {
    let hwnd = window
        .hwnd()
        .map_err(|_| "Could not access the taskbar window".to_owned())?;
    let mut registry = WINDOW_ICONS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Could not access taskbar icon lifetimes".to_owned())?;
    registry.retain(|_, state| state.strong_count() > 0);
    if let Some(state) = registry.get(&(hwnd.0 as usize)).and_then(Weak::upgrade) {
        return Ok(state);
    }
    let state = Arc::new(Mutex::new(WindowIcon::default()));
    let on_destroy = Arc::clone(&state);
    let key = hwnd.0 as usize;
    // Capture only the icon state, never a window/app handle (which could create a cycle).
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Destroyed) {
            return;
        }
        release_icon(&on_destroy);
        let Some(registry) = WINDOW_ICONS.get() else {
            return;
        };
        let Ok(mut registry) = registry.lock() else {
            return;
        };
        if registry
            .get(&key)
            .is_some_and(|entry| entry.ptr_eq(&Arc::downgrade(&on_destroy)))
        {
            registry.remove(&key);
        }
    });
    registry.insert(key, Arc::downgrade(&state));
    Ok(state)
}

pub(super) fn apply<R: Runtime>(
    window: &WebviewWindow<R>,
    icon: tauri::image::Image<'static>,
) -> Result<(), String> {
    let state = icon_state(window)?;
    let target = window.clone();
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let result = (|| {
                // Wry dispatches set_icon synchronously when already on its UI thread.
                // Tauri updates ICON_SMALL only; copy that exact image for ICON_BIG.
                target
                    .set_icon(icon)
                    .map_err(|_| "Could not update the window icon".to_owned())?;
                let hwnd = target
                    .hwnd()
                    .map_err(|_| "Could not access the taskbar window".to_owned())?;
                mirror_small_icon(hwnd.0, &state)
            })();
            let _ = send.send(result);
        })
        .map_err(|_| "Could not schedule the taskbar icon update".to_owned())?;
    receive
        .recv()
        .map_err(|_| "Could not complete the taskbar icon update".to_owned())?
}

// Native icon reads and writes are serialized on the HWND's thread.
fn mirror_small_icon(hwnd: HWND, state: &Mutex<WindowIcon>) -> Result<(), String> {
    unsafe {
        if GetWindowThreadProcessId(hwnd, ptr::null_mut()) != GetCurrentThreadId() {
            return Err("Taskbar icon update requires the window thread".to_owned());
        }
        let source = SendMessageW(hwnd, WM_GETICON, ICON_SMALL as WPARAM, 0) as HICON;
        if source.is_null() {
            return Err("Could not read the selected window icon".to_owned());
        }
        let copied = CopyIcon(source);
        if copied.is_null() {
            return Err("Could not copy the taskbar icon".to_owned());
        }
        let icon = OwnedIcon(copied as usize);
        let previous = {
            let mut state = state
                .lock()
                .map_err(|_| "Could not access the taskbar icon lifetime".to_owned())?;
            if state.destroyed {
                return Err("Could not update a closed taskbar window".to_owned());
            }
            state.current.replace(icon)
        };
        // Never hold the state lock across native message dispatch: Destroyed can be reentrant.
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as WPARAM, copied as LPARAM);
        drop(previous);
    }
    Ok(())
}

#[cfg(test)]
#[path = "app_icon_windows_test.rs"]
mod tests;
