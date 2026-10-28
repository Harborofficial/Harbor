#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub scale: f64,
    pub width: f64,
    pub height: f64,
    pub main: Rect,
    pub theme: Rect,
    pub submenu_left: bool,
}

// tray-menu.css: 7px border/padding + 44px header + 9px separator + 32px Show row.
pub const THEME_ROW_TOP: f64 = 92.0;

pub fn calculate(
    work: Rect,
    anchor: Rect,
    scale: f64,
    menu_width: f64,
    theme_width: f64,
    theme_count: usize,
    rtl: bool,
) -> Result<Geometry, &'static str> {
    const GAP: f64 = 6.0;
    const MAIN_HEIGHT: f64 = 300.0;
    const MIN_PANEL_WIDTH: f64 = 160.0;
    let numbers = [
        work.x,
        work.y,
        work.width,
        work.height,
        anchor.x,
        anchor.y,
        anchor.width,
        anchor.height,
        scale,
        menu_width,
        theme_width,
    ];
    if numbers.iter().any(|n| !n.is_finite()) || scale <= 0.0 {
        return Err("invalid tray popup geometry");
    }
    // Leave one physical pixel for fractional-DPI size rounding at work-area edges.
    let available_width = (work.width - 1.0) / scale;
    let available_height = (work.height - 1.0) / scale;
    let main_width = menu_width.max(MIN_PANEL_WIDTH);
    if available_width < main_width + GAP + MIN_PANEL_WIDTH || available_height < MAIN_HEIGHT {
        return Err("work area too small for tray popup");
    }
    let theme_width = theme_width.clamp(MIN_PANEL_WIDTH, available_width - main_width - GAP);
    let theme_height = (theme_count as f64 * 32.0 + 14.0).clamp(46.0, available_height.min(450.0));
    let left = work.x / scale;
    let top = work.y / scale;
    let right = left + available_width;
    let bottom = top + available_height;
    let mut main_x =
        ((anchor.x + anchor.width) / scale - main_width).clamp(left, right - main_width);
    let fits_left = main_x - GAP - theme_width >= left;
    let fits_right = main_x + main_width + GAP + theme_width <= right;
    let submenu_left = if rtl {
        fits_left || !fits_right
    } else {
        !fits_right && fits_left
    };
    if !fits_left && !fits_right {
        main_x = if submenu_left {
            right - main_width
        } else {
            left
        };
    }
    let above = anchor.y / scale - GAP - MAIN_HEIGHT;
    let below = (anchor.y + anchor.height) / scale + GAP;
    let main_y = if above >= top { above } else { below }.clamp(top, bottom - MAIN_HEIGHT);
    let theme_x = if submenu_left {
        main_x - GAP - theme_width
    } else {
        main_x + main_width + GAP
    };
    let theme_y = (main_y + THEME_ROW_TOP).clamp(top, bottom - theme_height);
    let origin_x = main_x.min(theme_x);
    let origin_y = main_y.min(theme_y);
    let width = (main_x + main_width).max(theme_x + theme_width) - origin_x;
    let height = (main_y + MAIN_HEIGHT).max(theme_y + theme_height) - origin_y;
    let x = (origin_x * scale).round().clamp(
        work.x.ceil(),
        (work.x + work.width - (width * scale).ceil()).floor(),
    ) as i32;
    let y = (origin_y * scale).round().clamp(
        work.y.ceil(),
        (work.y + work.height - (height * scale).ceil()).floor(),
    ) as i32;
    Ok(Geometry {
        x,
        y,
        scale,
        width,
        height,
        main: Rect {
            x: main_x - origin_x,
            y: main_y - origin_y,
            width: main_width,
            height: MAIN_HEIGHT,
        },
        theme: Rect {
            x: theme_x - origin_x,
            y: theme_y - origin_y,
            width: theme_width,
            height: theme_height,
        },
        submenu_left,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    fn assert_inside(g: Geometry, work: Rect) {
        assert!(g.x as f64 >= work.x);
        assert!(g.y as f64 >= work.y);
        assert!(g.x as f64 + (g.width * g.scale).ceil() <= work.x + work.width);
        assert!(g.y as f64 + (g.height * g.scale).ceil() <= work.y + work.height);
        for panel in [g.main, g.theme] {
            assert!(panel.x >= 0.0 && panel.y >= 0.0);
            assert!(panel.x + panel.width <= g.width);
            assert!(panel.y + panel.height <= g.height);
        }
    }

    #[test]
    fn bottom_right_tray_opens_submenu_left_without_moving_main() {
        let work = rect(0.0, 0.0, 1920.0, 1040.0);
        let g = calculate(
            work,
            rect(1800.0, 1040.0, 24.0, 40.0),
            1.0,
            280.0,
            230.0,
            80,
            false,
        )
        .unwrap();
        assert_inside(g, work);
        assert!(g.submenu_left);
        assert_eq!(g.main.width, 280.0);
        assert_eq!(g.main.height, 300.0);
        assert_eq!(g.theme.height, 450.0);
        assert_eq!(g.main.x - g.theme.x - g.theme.width, 6.0);
    }

    #[test]
    fn theme_panel_and_bridge_align_to_theme_row_below_header_and_show() {
        let g = calculate(
            rect(0.0, 0.0, 1920.0, 1200.0),
            rect(1800.0, -40.0, 24.0, 40.0),
            1.0,
            280.0,
            230.0,
            14,
            false,
        )
        .unwrap();
        assert_eq!(g.theme.y - g.main.y, 92.0);
    }

    #[test]
    fn top_left_taskbar_opens_right_on_negative_high_dpi_monitor() {
        let work = rect(-2560.0, -1440.0, 2560.0, 1380.0);
        let g = calculate(
            work,
            rect(-2560.0, -1480.0, 40.0, 40.0),
            1.5,
            300.0,
            260.0,
            14,
            false,
        )
        .unwrap();
        assert_inside(g, work);
        assert!(!g.submenu_left);
        assert_eq!(g.main.height, 300.0);
        assert!(g.y >= -1440);
    }

    #[test]
    fn narrow_work_area_caps_submenu_while_preserving_main_width() {
        let work = rect(0.0, 0.0, 800.0, 600.0);
        let g = calculate(
            work,
            rect(770.0, 600.0, 24.0, 30.0),
            1.25,
            400.0,
            400.0,
            4000,
            true,
        )
        .unwrap();
        assert_inside(g, work);
        assert_eq!(g.main.width, 400.0);
        assert!(g.width <= 640.0);
        assert!(g.theme.height <= 450.0);
    }

    #[test]
    fn long_command_labels_fall_back_instead_of_shrinking_the_main_panel() {
        let result = calculate(
            rect(0.0, 0.0, 800.0, 1040.0),
            rect(770.0, 1040.0, 30.0, 40.0),
            2.0,
            420.0,
            220.0,
            14,
            false,
        );
        assert!(result.is_err());
    }

    #[test]
    fn impossible_or_nonfinite_geometry_falls_back_to_native() {
        let tiny = rect(0.0, 0.0, 240.0, 200.0);
        let normal = rect(0.0, 0.0, 1920.0, 1040.0);
        let anchor = rect(1800.0, 1040.0, 24.0, 40.0);
        assert!(calculate(tiny, anchor, 1.0, 280.0, 230.0, 14, false).is_err());
        assert!(calculate(normal, anchor, f64::NAN, 280.0, 230.0, 14, false).is_err());
        assert!(calculate(normal, anchor, 1.0, f64::INFINITY, 230.0, 14, false).is_err());
    }

    #[test]
    fn fractional_dpi_and_work_area_edges_keep_entire_popup_on_screen() {
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            for width in [801.0, 1365.0, 1919.0] {
                let work = rect(-width, -1079.0, width, 1039.0);
                for anchor in [
                    rect(-width - 40.0, -500.0, 40.0, 30.0),
                    rect(-30.0, -40.0, 30.0, 40.0),
                ] {
                    for main_width in [240.0, 420.0, 600.0] {
                        let result = calculate(work, anchor, scale, main_width, 600.0, 1024, false);
                        if (width - 1.0) / scale < main_width + 6.0 + 160.0 {
                            assert!(result.is_err());
                        } else {
                            let g = result.unwrap();
                            assert_inside(g, work);
                            assert_eq!(g.main.width, main_width);
                        }
                    }
                }
            }
        }
    }
}
