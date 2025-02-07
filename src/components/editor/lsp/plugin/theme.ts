import { Compartment, Extension, StateEffect, StateField, Transaction } from "@uiw/react-codemirror";
import { Settings } from "@uiw/codemirror-themes";
import {
  materialDark,
  materialLight,
  defaultSettingsMaterialDark,
  defaultSettingsMaterialLight,
} from "@uiw/codemirror-theme-material";
import {
  gruvboxDark,
  gruvboxLight,
  defaultSettingsGruvboxDark,
  defaultSettingsGruvboxLight,
} from "@uiw/codemirror-theme-gruvbox-dark";
import { DefaultColorScheme, DefaultTheme } from "..";

export type Theme = "gruvbox" | "material";
export type ColorScheme = "light" | "dark";

const getThemeSetting = (theme: Theme, color: ColorScheme): Settings => {
  if (theme === "gruvbox" && color === "dark") {
    return defaultSettingsGruvboxDark;
  } else if (theme === "gruvbox" && color === "light") {
    return defaultSettingsGruvboxLight;
  } else if (theme === "material" && color === "dark") {
    return defaultSettingsMaterialDark;
  } else if (theme === "material" && color === "light") {
    return defaultSettingsMaterialLight;
  } else {
    throw new Error("You selected a theme that doesn't exist");
  }
};

function getThemeExtension(theme: Theme, color: ColorScheme): Extension {
  switch (theme) {
    case "gruvbox":
      if (color === "dark") {
        return gruvboxDark;
      } else {
        return gruvboxLight;
      }
    case "material":
      if (color === "dark") {
        return materialDark;
      } else {
        return materialLight;
      }
  }
}

export const themeColorScheme = StateEffect.define();
export const themeEffect = StateEffect.define<Settings>();

export const themeSettingsField = StateField.define<Settings>({
  create(state) {
    const theme = state.facet(DefaultTheme);
    const color = state.facet(DefaultColorScheme);
    return getThemeSetting(theme, color);
  },

  update(value, tr: Transaction) {
    for (const effect of tr.effects) {
      if (effect.is(themeEffect)) {
        value = effect.value;
      }
    }
    return value;
  },
});

export const themeConfig = new Compartment();

// Change the theme of the editor
// TODO(Alec): use the actual type here
export function changeEditorTheme({ dispatch }, theme: Theme, colorScheme?: ColorScheme) {
  const color = (colorScheme ?? window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
  dispatch({
    effects: [themeConfig.reconfigure(getThemeExtension(theme, color)), themeEffect.of(getThemeSetting(theme, color))],
  });
}

export const themeExtension = (theme: Theme, colorScheme?: ColorScheme): Extension => {
  const color = (colorScheme ?? window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
  return [themeConfig.of(getThemeExtension(theme, color)), themeSettingsField];
};
