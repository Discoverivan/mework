use super::*;
use windows_sys::{
    w,
    Win32::{
        Graphics::Gdi::{
            CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, BITMAPINFO, BITMAPINFOHEADER,
            BI_RGB, DIB_RGB_COLORS,
        },
        UI::WindowsAndMessaging::{
            CreateIcon, CreateWindowExW, DestroyWindow, GetIconInfo, ICONINFO, WS_OVERLAPPEDWINDOW,
        },
    },
};

struct HiddenWindow(HWND);

impl Drop for HiddenWindow {
    fn drop(&mut self) {
        unsafe { DestroyWindow(self.0) };
    }
}

fn solid_icon(bgra: [u8; 4]) -> OwnedIcon {
    let pixels = bgra.repeat(16 * 16);
    // Match Tao's generously sized mask buffer, including native scan-line padding.
    let mask = [0u8; 16 * 16];
    let handle = unsafe {
        CreateIcon(
            ptr::null_mut(),
            16,
            16,
            1,
            32,
            mask.as_ptr(),
            pixels.as_ptr(),
        )
    };
    assert!(!handle.is_null());
    OwnedIcon(handle as usize)
}

fn icon_pixel(icon: HICON) -> [u8; 4] {
    unsafe {
        let mut info = ICONINFO::default();
        assert_ne!(GetIconInfo(icon, &mut info), 0);
        let dc = CreateCompatibleDC(ptr::null_mut());
        assert!(!dc.is_null());
        let mut bitmap = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: 16,
                biHeight: -16,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = [0u8; 16 * 16 * 4];
        let rows = GetDIBits(
            dc,
            info.hbmColor,
            0,
            16,
            pixels.as_mut_ptr().cast(),
            &mut bitmap,
            DIB_RGB_COLORS,
        );
        DeleteDC(dc);
        DeleteObject(info.hbmColor);
        DeleteObject(info.hbmMask);
        assert_eq!(rows, 16);
        pixels[..4].try_into().unwrap()
    }
}

#[test]
fn selected_icon_updates_taskbar_pixels_and_releases_owned_handles() {
    unsafe {
        // A native hidden window exercises the same HWND helper without launching the app.
        let window = HiddenWindow(CreateWindowExW(
            0,
            w!("STATIC"),
            w!("Example icon window"),
            WS_OVERLAPPEDWINDOW,
            0,
            0,
            320,
            200,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null(),
        ));
        assert!(!window.0.is_null());
        let first = solid_icon([30, 60, 210, 255]);
        let second = solid_icon([160, 90, 20, 255]);
        let state = Mutex::new(WindowIcon::default());
        SendMessageW(
            window.0,
            WM_SETICON,
            ICON_SMALL as WPARAM,
            first.0 as LPARAM,
        );
        mirror_small_icon(window.0, &state).unwrap();
        let first_big = SendMessageW(window.0, WM_GETICON, ICON_BIG as WPARAM, 0) as HICON;
        assert_ne!(first_big, first.0 as HICON);
        assert_eq!(icon_pixel(first_big)[..3], [30, 60, 210]);
        SendMessageW(
            window.0,
            WM_SETICON,
            ICON_SMALL as WPARAM,
            second.0 as LPARAM,
        );
        mirror_small_icon(window.0, &state).unwrap();
        let second_big = SendMessageW(window.0, WM_GETICON, ICON_BIG as WPARAM, 0) as HICON;
        assert_eq!(icon_pixel(second_big)[..3], [160, 90, 20]);
        let mut removed = ICONINFO::default();
        assert_eq!(GetIconInfo(first_big, &mut removed), 0);
        drop(window);
        // Production calls this same cleanup from Tauri's Destroyed event.
        release_icon(&state);
        assert_eq!(GetIconInfo(second_big, &mut removed), 0);
        // The source handles belong to the caller and survive replacement and window closure.
        assert_eq!(icon_pixel(first.0 as HICON)[..3], [30, 60, 210]);
        assert_eq!(icon_pixel(second.0 as HICON)[..3], [160, 90, 20]);
    }
}
