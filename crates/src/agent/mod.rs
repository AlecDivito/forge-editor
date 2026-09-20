//! Native agent runtime building blocks.
//!
//! The current chat actor continues to live in `actors` while the durable
//! harness is introduced incrementally. New session persistence primitives
//! belong here so provider and title tasks cannot write session files directly.

pub mod error;
pub mod session;
pub mod tools;
