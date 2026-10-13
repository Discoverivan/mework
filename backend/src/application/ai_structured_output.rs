use serde::de::DeserializeOwned;
use serde_json::Value;

/// Keep reasoning out of the result without changing how the model reasons.
/// Only a complete, unique top-level object at the end of the answer is accepted.
pub(crate) fn json_object(text: &str) -> Result<&str, &'static str> {
    let text = text.trim();
    if serde_json::from_str::<Value>(text).is_ok_and(|value| value.is_object()) {
        return Ok(text);
    }
    if text.starts_with("<think>") && !text.contains("</think>") {
        return Err("Incomplete reasoning block");
    }
    // Try the intact answer first so tags in JSON strings remain ordinary data.
    let intact = unwrap_fence(text).and_then(scan_object);
    if intact.is_ok() {
        return intact;
    }
    // Some compatible servers omit the opening tag but retain the closing tag.
    if let Some((_, answer)) = text.rsplit_once("</think>") {
        return unwrap_fence(answer.trim()).and_then(scan_object);
    }
    intact
}

fn unwrap_fence(text: &str) -> Result<&str, &'static str> {
    if let Some((prefix, fenced)) = text.split_once("```") {
        if prefix.contains(['{', '[']) {
            return Ok(text);
        }
        let (language, body) = fenced.split_once('\n').ok_or("Incomplete JSON fence")?;
        if !matches!(language.trim(), "json" | "") {
            return Err("Unsupported JSON fence");
        }
        return body
            .strip_suffix("```")
            .ok_or("Incomplete JSON fence")
            .map(str::trim);
    }
    Ok(text)
}

fn scan_object(text: &str) -> Result<&str, &'static str> {
    let mut stack = Vec::new();
    let mut start = 0;
    let mut quoted = false;
    let mut escaped = false;
    let mut candidate = None;
    for (offset, byte) in text.bytes().enumerate() {
        if quoted {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                quoted = false;
            }
            continue;
        }
        match byte {
            b'"' if !stack.is_empty() => quoted = true,
            b'{' | b'[' => {
                if stack.is_empty() {
                    start = offset;
                }
                stack.push(byte);
            }
            b'}' | b']' if !stack.is_empty() => {
                let open = stack.pop().unwrap();
                if (open, byte) != (b'{', b'}') && (open, byte) != (b'[', b']') {
                    return Err("Unbalanced JSON containers");
                }
                if stack.is_empty() {
                    let raw = &text[start..=offset];
                    let value =
                        serde_json::from_str::<Value>(raw).map_err(|_| "Invalid JSON container")?;
                    if candidate.is_some() || !value.is_object() {
                        return Err("Ambiguous structured output");
                    }
                    candidate = Some((raw, offset + 1));
                }
            }
            _ => {}
        }
    }
    if !stack.is_empty() || quoted {
        return Err("Incomplete structured output");
    }
    let (raw, end) = candidate.ok_or("Missing JSON object")?;
    if !text[end..].trim().is_empty() {
        return Err("Trailing structured output");
    }
    Ok(raw)
}

pub(crate) fn deserialize<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, ()> {
    let text = std::str::from_utf8(bytes).map_err(|_| ())?;
    serde_json::from_str(json_object(text).map_err(|_| ())?).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    #[test]
    fn extracts_the_complete_final_object_after_reasoning() {
        let answer = "Reasoning about {\"example\":true} and braces. </think>\n```json\n{\"summary\":\"Example {task} with \\\"quotes\\\"\",\"items\":[{\"id\":1}]}\n```";
        let value: serde_json::Value = super::deserialize(answer.as_bytes()).unwrap();
        assert_eq!(value["items"][0]["id"], 1);
        assert_eq!(value["summary"], "Example {task} with \"quotes\"");
    }

    #[test]
    fn refuses_ambiguous_or_incomplete_final_answers() {
        assert!(
            super::json_object("{\"summary\":\"Example one\"}\n{\"summary\":\"Example two\"}")
                .is_err()
        );
        assert!(super::json_object("{\"result\":{\"summary\":\"Example task\"}").is_err());
        assert!(
            super::json_object("<think>Unfinished reasoning {\"summary\":\"Example task\"}")
                .is_err()
        );
    }
}
