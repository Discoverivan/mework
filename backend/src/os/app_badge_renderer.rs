#[path = "app_badge_glyphs.rs"]
mod glyphs;

const LOGICAL_SIZE: f32 = 16.0;
const SAMPLES: u32 = 8;

pub(super) fn icon_size(scale_factor: f64) -> u32 {
    (16.0 * scale_factor).round().clamp(16.0, 64.0) as u32
}

pub(super) fn render(count: u64, size: u32) -> Option<Vec<u8>> {
    if count == 0 {
        return None;
    }

    let label = if count > 99 {
        "99+".to_owned()
    } else {
        count.to_string()
    };
    let glyphs: Vec<_> = label
        .bytes()
        .map(|byte| {
            &glyphs::GLYPHS[if byte == b'+' {
                10
            } else {
                (byte - b'0') as usize
            }]
        })
        .collect();
    let gap = if glyphs.len() == 2 { 0.8 } else { 0.5 };
    let width_scale = match glyphs.len() {
        1 => 1.0,
        2 => 0.9,
        _ => 0.8,
    };
    let target_height: f32 = match glyphs.len() {
        1 => 9.5,
        2 => 8.8,
        _ => 7.2,
    };
    let width_units: f32 = glyphs
        .iter()
        .map(|glyph| glyph.width as f32 * width_scale / 1000.0)
        .sum();
    let gaps = gap * (glyphs.len() - 1) as f32;
    let max_width = if glyphs.len() == 2 { 11.8 } else { 13.0 };
    let height = target_height.min((max_width - gaps) / width_units);
    let mut left = (LOGICAL_SIZE - width_units * height - gaps) / 2.0;
    if count == 1 {
        // The flag extends 1's bounds leftward, but its thick upright moves the
        // ink centroid 0.75 logical px rightward. Center its visual weight.
        left -= 0.75;
    }
    let top = (LOGICAL_SIZE - height) / 2.0;
    let mut edges = Vec::new();
    for glyph in glyphs {
        for contour in glyph.contours {
            for index in 0..contour.len() {
                let point = |(x, y): (i16, i16)| {
                    (
                        left + x as f32 * height * width_scale / 1000.0,
                        top + y as f32 * height / 1000.0,
                    )
                };
                edges.push((
                    point(contour[index]),
                    point(contour[(index + 1) % contour.len()]),
                ));
            }
        }
        left += glyph.width as f32 * height * width_scale / 1000.0 + gap;
    }

    // Scan-convert the filled outlines at 8x resolution. Font contours use
    // nonzero winding: same-direction strokes overlap without holes, while
    // opposite-direction contours keep numeral counters open.
    let sampled_size = size * SAMPLES;
    let sample_scale = sampled_size as f32 / LOGICAL_SIZE;
    let mut text = vec![false; (sampled_size * sampled_size) as usize];
    let mut intersections = Vec::new();
    for row in 0..sampled_size {
        let y = (row as f32 + 0.5) / sample_scale;
        intersections.clear();
        for &((x1, y1), (x2, y2)) in &edges {
            if (y1 > y) != (y2 > y) {
                let x = x1 + (y - y1) * (x2 - x1) / (y2 - y1);
                intersections.push((x, if y2 > y1 { 1 } else { -1 }));
            }
        }
        intersections.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
        let mut winding = 0;
        let mut span_start = 0.0;
        for &(x, direction) in &intersections {
            let previous = winding;
            winding += direction;
            if previous == 0 && winding != 0 {
                span_start = x;
            } else if previous != 0 && winding == 0 {
                let start = ((span_start * sample_scale - 0.5).ceil() as u32).min(sampled_size);
                let end = ((x * sample_scale - 0.5).ceil() as u32).min(sampled_size);
                let offset = (row * sampled_size) as usize;
                text[offset + start as usize..offset + end as usize].fill(true);
            }
        }
    }

    let mut pixels = vec![0; (size * size * 4) as usize];
    let circular = label.len() == 1;
    for y in 0..size {
        for x in 0..size {
            let mut color = [0.0; 3];
            let mut coverage = 0;
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let sample_x = x * SAMPLES + sx;
                    let sample_y = y * SAMPLES + sy;
                    let px = (sample_x as f32 + 0.5) / sample_scale;
                    let py = (sample_y as f32 + 0.5) / sample_scale;
                    // Longer labels get a rounded rectangle so the numerals keep
                    // comfortable padding even at their outer baseline corners.
                    let (radius, dx, dy) = if circular {
                        (7.5, (px - 8.0).abs(), (py - 8.0).abs())
                    } else {
                        (
                            4.8,
                            ((px - 8.0).abs() - 2.8).max(0.0),
                            ((py - 8.0).abs() - 2.1).max(0.0),
                        )
                    };
                    let distance = (dx * dx + dy * dy).sqrt();
                    if distance > radius {
                        continue;
                    }
                    coverage += 1;
                    let sample_color = if text[(sample_y * sampled_size + sample_x) as usize] {
                        [255.0; 3]
                    } else {
                        // A restrained coral-to-crimson finish echoes the app icon.
                        let t = ((px + py) / 32.0).clamp(0.0, 1.0);
                        let rim = if distance > radius - 0.45 { 0.87 } else { 1.0 };
                        [
                            (246.0 - 27.0 * t) * rim,
                            (68.0 - 30.0 * t) * rim,
                            (80.0 + 17.0 * t) * rim,
                        ]
                    };
                    for channel in 0..3 {
                        color[channel] += sample_color[channel];
                    }
                }
            }
            if coverage > 0 {
                let offset = ((y * size + x) * 4) as usize;
                // Tauri takes straight RGBA: coverage belongs only in alpha, not
                // RGB, so translucent edges do not acquire a dark fringe.
                for channel in 0..3 {
                    pixels[offset + channel] = (color[channel] / coverage as f32).round() as u8;
                }
                pixels[offset + 3] =
                    (255.0 * coverage as f32 / (SAMPLES * SAMPLES) as f32).round() as u8;
            }
        }
    }
    Some(pixels)
}

#[cfg(test)]
mod tests {
    #[test]
    fn unread_overlay_renders_smoothly_at_display_resolution_and_clears_at_zero() {
        assert!(super::render(0, 16).is_none());
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let size = super::icon_size(scale);
            assert_eq!(size, (16.0 * scale) as u32);
            let pixels = super::render(42, size).expect("positive unread count draws an overlay");
            assert_eq!(pixels.len(), (size * size * 4) as usize);
            let rgba = pixels.as_chunks::<4>().0;
            assert!(rgba.iter().any(|pixel| pixel[3] > 0 && pixel[3] < 255));
            assert!(rgba.contains(&[255, 255, 255, 255]));
            assert_eq!(pixels[3], 0);
        }

        // Inter builds 4 and + from overlapping contours. Their stroke
        // intersections must stay solid while the numeral counters stay open.
        for (count, x, y) in [(4, 39, 41), (100, 50, 34)] {
            let pixels = super::render(count, 64).expect("positive count draws its numeral");
            let offset = (y * 64 + x) * 4;
            assert_eq!(
                &pixels[offset..offset + 4],
                &[255, 255, 255, 255],
                "stroke intersection for {count} must remain filled"
            );
        }
        // The asymmetric flag of 1 must not push its visible weight rightward.
        let one = super::render(1, 64).expect("one unread item draws its numeral");
        let mut white_center_sum = 0.0;
        let mut white_pixels = 0;
        for (index, &pixel) in one.as_chunks::<4>().0.iter().enumerate() {
            if pixel == [255, 255, 255, 255] {
                white_center_sum += (index % 64) as f32 + 0.5;
                white_pixels += 1;
            }
        }
        assert!(white_pixels > 0);
        assert!((white_center_sum / white_pixels as f32 - 32.0).abs() < 0.75);

        let eight = super::render(8, 64).expect("unread count draws its numeral");
        for y in [23, 40] {
            let offset = (y * 64 + 32) * 4;
            assert!(eight[offset + 1] < 100, "8 must retain both red counters");
            assert_eq!(eight[offset + 3], 255);
        }
    }
}
