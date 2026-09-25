use tauri::{AppHandle, Manager};

#[cfg(any(target_os = "windows", test))]
const BADGE_ICON_SIZE: u32 = 16;
#[cfg(any(target_os = "windows", test))]
const BADGE_RADIUS_SQUARED: i32 = 49;
#[cfg(any(target_os = "windows", test))]
const BADGE_RED: [u8; 4] = [220, 46, 61, 255];
#[cfg(any(target_os = "windows", test))]
const BADGE_TEXT: [u8; 4] = [255, 255, 255, 255];
#[cfg(any(target_os = "windows", test))]
const FONT_3X5: [[u8; 5]; 11] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b010, 0b010, 0b010],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
    [0b010, 0b010, 0b111, 0b010, 0b010],
];

#[cfg(any(target_os = "windows", test))]
fn windows_overlay_pixels(count: u64) -> Option<Vec<u8>> {
    if count == 0 {
        return None;
    }

    let glyphs: Vec<usize> = if count > 99 {
        vec![9, 9, 10]
    } else {
        count
            .to_string()
            .bytes()
            .map(|digit| (digit - b'0') as usize)
            .collect()
    };
    let text_width = glyphs.len() * 4 - 1;
    let text_left = (BADGE_ICON_SIZE as usize - text_width) / 2;
    let text_top = (BADGE_ICON_SIZE as usize - 5) / 2;
    let mut pixels = vec![0; (BADGE_ICON_SIZE * BADGE_ICON_SIZE * 4) as usize];

    for y in 0..BADGE_ICON_SIZE as i32 {
        for x in 0..BADGE_ICON_SIZE as i32 {
            let dx = x - BADGE_ICON_SIZE as i32 / 2;
            let dy = y - BADGE_ICON_SIZE as i32 / 2;
            if dx * dx + dy * dy <= BADGE_RADIUS_SQUARED {
                let offset = ((y as u32 * BADGE_ICON_SIZE + x as u32) * 4) as usize;
                pixels[offset..offset + 4].copy_from_slice(&BADGE_RED);
            }
        }
    }

    for (glyph_index, glyph) in glyphs.iter().enumerate() {
        for (row, mask) in FONT_3X5[*glyph].iter().enumerate() {
            for column in 0..3 {
                if mask & (1 << (2 - column)) == 0 {
                    continue;
                }
                let x = text_left + glyph_index * 4 + column;
                let y = text_top + row;
                let offset = (y * BADGE_ICON_SIZE as usize + x) * 4;
                pixels[offset..offset + 4].copy_from_slice(&BADGE_TEXT);
            }
        }
    }

    Some(pixels)
}

pub fn set_unread_count(app: &AppHandle, count: u64) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    #[cfg(target_os = "windows")]
    {
        let icon = windows_overlay_pixels(count)
            .map(|pixels| tauri::image::Image::new_owned(pixels, BADGE_ICON_SIZE, BADGE_ICON_SIZE));
        window.set_overlay_icon(icon)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let badge_count = if count == 0 {
            None
        } else {
            Some(count.min(i64::MAX as u64) as i64)
        };
        window.set_badge_count(badge_count)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn windows_overlay_is_cleared_at_zero_and_drawn_for_unread_items() {
        assert!(super::windows_overlay_pixels(0).is_none());

        let pixels = super::windows_overlay_pixels(42)
            .expect("positive unread count should draw an overlay");
        assert_eq!(pixels.len(), 16 * 16 * 4);
        assert!(pixels.chunks(4).any(|pixel| pixel[3] > 0));
        assert!(pixels.chunks(4).any(|pixel| pixel == [255, 255, 255, 255]));
    }
}
