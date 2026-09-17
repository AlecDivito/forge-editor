use std::ops::Range;

use rovo::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, JsonSchema)]
pub struct PaginationParams {
    page: Option<usize>,
    size: Option<usize>,
    read_all: Option<bool>,
}

impl PaginationParams {
    pub fn get_page(&self) -> usize {
        self.page.unwrap_or(0)
    }

    pub fn get_size(&self) -> usize {
        self.size.unwrap_or(1000)
    }

    pub fn get_read_all(&self) -> bool {
        self.read_all.unwrap_or(false)
    }

    pub fn get_index_range(&self) -> Range<usize> {
        (self.get_page() * self.get_size())..(self.get_page() + self.get_size())
    }
}
