use serde_json::Value;

pub fn canonicalize(snapshot: &Value) -> Value {
    match snapshot {
        Value::Object(fields) => {
            let mut canonical = fields.clone();
            canonical.remove("updated_at");
            canonical.remove("observed_at");
            Value::Object(canonical)
        }
        other => other.clone(),
    }
}
