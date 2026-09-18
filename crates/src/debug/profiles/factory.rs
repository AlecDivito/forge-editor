use super::{
    DebugStrategy, go::GoStrategy, node::NodeStrategy, python::PythonStrategy, rust::RustStrategy,
};

/// Returns the built-in strategy for an approved Forge adapter type.
///
/// Forge deliberately has a closed adapter set; there is no runtime strategy
/// registration or plugin loading path.
pub fn strategy_for(type_id: &str) -> Option<Box<dyn DebugStrategy>> {
    match type_id {
        "forge-rust" => Some(Box::new(RustStrategy)),
        "forge-go" => Some(Box::new(GoStrategy)),
        "forge-node" => Some(Box::new(NodeStrategy)),
        "forge-python" => Some(Box::new(PythonStrategy)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_each_built_in_strategy() {
        for adapter_type in ["forge-go", "forge-node", "forge-python", "forge-rust"] {
            assert!(strategy_for(adapter_type).is_some());
        }
        assert!(strategy_for("unknown").is_none());
    }
}
