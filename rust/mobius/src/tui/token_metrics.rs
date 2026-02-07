use std::collections::HashMap;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Sparkline, Widget};

use super::theme::{
    format_token_pair, model_color, BORDER_COLOR, HEADER_COLOR, MUTED_COLOR, NORD8, TEXT_COLOR,
};

/// Height of the token metrics widget (including borders).
/// 2 (borders) + 1 (totals line) + up to 3 model lines + 3 (sparkline rows) = ~9
/// We use a fixed height to keep layout predictable.
pub const TOKEN_METRICS_HEIGHT: u16 = 9;

pub struct TokenMetrics<'a> {
    pub total_input: u64,
    pub total_output: u64,
    pub per_model: &'a HashMap<String, (u64, u64)>,
    pub token_history: &'a [u64],
}

impl Widget for TokenMetrics<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(BORDER_COLOR))
            .title(Span::styled(
                " Token Usage ",
                Style::default().fg(HEADER_COLOR),
            ));

        let inner = block.inner(area);
        block.render(area, buf);

        if inner.height == 0 || inner.width == 0 {
            return;
        }

        let mut row = inner.y;

        // Section 1: Cumulative totals
        let totals_text = if self.total_input == 0 && self.total_output == 0 {
            "Tokens: —".to_string()
        } else {
            format!(
                "Tokens: {}",
                format_token_pair(self.total_input, self.total_output)
            )
        };
        let totals_line = Line::from(Span::styled(totals_text, Style::default().fg(TEXT_COLOR)));
        buf.set_line(
            inner.x + 1,
            row,
            &totals_line,
            inner.width.saturating_sub(1),
        );
        row += 1;

        if row >= inner.y + inner.height {
            return;
        }

        // Section 2: Per-model breakdown
        if self.per_model.is_empty() {
            let no_models = Line::from(Span::styled(
                "  No active models",
                Style::default().fg(MUTED_COLOR),
            ));
            buf.set_line(inner.x + 1, row, &no_models, inner.width.saturating_sub(1));
            row += 1;
        } else {
            let mut model_names: Vec<&String> = self.per_model.keys().collect();
            model_names.sort();

            for name in model_names {
                if row >= inner.y + inner.height {
                    break;
                }
                let (inp, out) = self.per_model[name];
                let short_name = extract_model_short_name(name);
                let line = Line::from(vec![
                    Span::styled(
                        format!("  {} ", short_name),
                        Style::default().fg(model_color(name)),
                    ),
                    Span::styled(format_token_pair(inp, out), Style::default().fg(TEXT_COLOR)),
                ]);
                buf.set_line(inner.x + 1, row, &line, inner.width.saturating_sub(1));
                row += 1;
            }
        }

        if row >= inner.y + inner.height {
            return;
        }

        // Section 3: Sparkline burn rate
        let sparkline_height = (inner.y + inner.height).saturating_sub(row);
        if sparkline_height == 0 {
            return;
        }

        if self.token_history.is_empty() {
            let placeholder = Line::from(Span::styled(
                "  ▁▁▁ awaiting data",
                Style::default().fg(MUTED_COLOR),
            ));
            buf.set_line(
                inner.x + 1,
                row,
                &placeholder,
                inner.width.saturating_sub(1),
            );
        } else {
            let sparkline_area = Rect::new(
                inner.x + 1,
                row,
                inner.width.saturating_sub(2),
                sparkline_height.min(2),
            );
            let sparkline = Sparkline::default()
                .data(self.token_history)
                .style(Style::default().fg(NORD8));
            sparkline.render(sparkline_area, buf);
        }
    }
}

/// Extract a short model name from a full model string.
/// "claude-opus-4-6" -> "opus", "claude-sonnet-4-5-20250929" -> "sonnet"
fn extract_model_short_name(model: &str) -> &str {
    let lower = model.to_lowercase();
    if lower.contains("opus") {
        "opus"
    } else if lower.contains("sonnet") {
        "sonnet"
    } else if lower.contains("haiku") {
        "haiku"
    } else {
        model
    }
}
