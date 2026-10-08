use std::collections::HashMap;

pub(super) struct ReviewDiff {
    pub numbered: String,
    files: HashMap<String, Vec<(u64, String)>>,
}

fn header_path(value: &str) -> String {
    let value = value.split('\t').next().unwrap_or(value).trim();
    let decoded = quoted_path(value).unwrap_or_else(|| value.to_owned());
    decoded
        .strip_prefix("a/")
        .or_else(|| decoded.strip_prefix("b/"))
        .or_else(|| decoded.strip_prefix("src://"))
        .or_else(|| decoded.strip_prefix("dst://"))
        .unwrap_or(&decoded)
        .to_owned()
}

// Git quotes paths using C escapes, including octal UTF-8 bytes that JSON
// strings do not support. Keep the provider's path bytes when decoding them.
fn quoted_path(value: &str) -> Option<String> {
    let mut input = value.strip_prefix('"')?.strip_suffix('"')?.bytes();
    let mut output = Vec::new();
    while let Some(byte) = input.next() {
        if byte != b'\\' {
            output.push(byte);
            continue;
        }
        let escaped = input.next()?;
        output.push(match escaped {
            b'0'..=b'3' => {
                let second = input.next()?.checked_sub(b'0')?;
                let third = input.next()?.checked_sub(b'0')?;
                if second > 7 || third > 7 {
                    return None;
                }
                (escaped - b'0') * 64 + second * 8 + third
            }
            b'a' => 7,
            b'b' => 8,
            b't' => b'\t',
            b'n' => b'\n',
            b'v' => 11,
            b'f' => 12,
            b'r' => b'\r',
            b'\\' | b'"' => escaped,
            _ => return None,
        });
    }
    String::from_utf8(output).ok()
}

fn git_destination(header: &str) -> Option<String> {
    // Spaces alone are not quoted by Git. The destination prefix separates
    // unquoted paths; quoted source paths end at an unescaped quotation mark.
    let destination = if let Some(source) = header.strip_prefix('"') {
        let mut escaped = false;
        let end = source.char_indices().find_map(|(index, character)| {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                return Some(index);
            }
            None
        })?;
        source.get(end + 1..)?.trim_start()
    } else if let Some((_, destination)) = header.split_once(" \"b/") {
        return Some(header_path(&format!("\"b/{destination}")));
    } else {
        let (_, destination) = header.split_once(" b/")?;
        return Some(header_path(&format!("b/{destination}")));
    };
    Some(header_path(destination))
}

fn range(value: &str) -> Option<(u64, u64)> {
    let value = value.get(1..)?;
    let (start, count) = value.split_once(',').unwrap_or((value, "1"));
    Some((start.parse().ok()?, count.parse().ok()?))
}

impl ReviewDiff {
    pub fn parse(diff: &str) -> Self {
        let mut result = Self {
            numbered: String::new(),
            files: HashMap::new(),
        };
        let mut source = String::new();
        let mut path = String::new();
        let mut hunk: Option<(u64, u64, u64)> = None;
        for raw in diff.lines() {
            let mut destination_line = None;
            if let Some(header) = raw.strip_prefix("diff --git ") {
                source.clear();
                path = git_destination(header).unwrap_or_default();
                if !path.is_empty() {
                    result.files.entry(path.clone()).or_default();
                }
                hunk = None;
            } else if raw.starts_with("@@ ") {
                let mut parts = raw.split_whitespace();
                let _ = parts.next();
                hunk = parts
                    .next()
                    .and_then(range)
                    .zip(parts.next().and_then(range))
                    .map(|((_, old_count), (new_start, new_count))| {
                        (new_start, old_count, new_count)
                    });
            } else if let Some((next, old_remaining, new_remaining)) = hunk.as_mut() {
                match raw.as_bytes().first() {
                    Some(b' ' | b'+') if *new_remaining > 0 => {
                        if raw.starts_with(' ') {
                            *old_remaining = old_remaining.saturating_sub(1);
                        }
                        destination_line = Some(*next);
                        *next = next.saturating_add(1);
                        *new_remaining -= 1;
                    }
                    Some(b'-') => *old_remaining = old_remaining.saturating_sub(1),
                    _ => {}
                }
                if *old_remaining == 0 && *new_remaining == 0 {
                    hunk = None;
                }
            } else if let Some(value) = raw.strip_prefix("--- ") {
                source = header_path(value);
            } else if let Some(value) = raw.strip_prefix("+++ ") {
                path = if value == "/dev/null" {
                    source.clone()
                } else {
                    header_path(value)
                };
                result.files.entry(path.clone()).or_default();
            }
            if let Some(line) = destination_line.filter(|line| *line > 0 && !path.is_empty()) {
                let text = &raw[1..];
                result
                    .files
                    .entry(path.clone())
                    .or_default()
                    .push((line, text.to_owned()));
                result
                    .numbered
                    .push_str(&format!("{}[new:{line}] {text}\n", &raw[..1]));
            } else {
                result.numbered.push_str(raw);
                result.numbered.push('\n');
            }
        }
        result
    }

    pub fn contains_file(&self, path: &str) -> bool {
        self.files.contains_key(path)
    }

    // A quotation grounds the anchor in code. Never guess the nearest line for
    // ambiguous/repeated text or move a finding to a different file.
    pub fn resolve(
        &self,
        path: &str,
        requested: Option<u64>,
        quotation: Option<&str>,
    ) -> Option<u64> {
        let requested = requested?;
        let lines = self.files.get(path)?;
        if let Some(text) = quotation.filter(|text| !text.trim().is_empty()) {
            let candidates: Vec<_> = lines
                .iter()
                .filter(|(_, code)| code.trim() == text.trim())
                .collect();
            if candidates.iter().any(|(number, _)| *number == requested) {
                return Some(requested);
            }
            if candidates.len() == 1 {
                return Some(candidates[0].0);
            }
            None
        } else {
            None
        }
    }
}
