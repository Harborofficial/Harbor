import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { profileThemeScope, type ProfileTheme } from "@/lib/profile-theme";

const ProfileThemeContext = createContext<ProfileTheme | null>(null);

export function ProfileThemeProvider({
  theme,
  children,
}: {
  theme: ProfileTheme;
  children: ReactNode;
}) {
  return <ProfileThemeContext.Provider value={theme}>{children}</ProfileThemeContext.Provider>;
}

/**
 * Style for a surface portaled out of the profile (a dialog opened from it). The profile theme
 * still applies, but glass is dropped: a dialog covers the whole app, so a see-through panel
 * would be unreadable. Returns undefined when the profile has no theme of its own.
 */
export function useProfileThemeSurfaceStyle(): CSSProperties | undefined {
  const theme = useContext(ProfileThemeContext);
  if (!theme) return undefined;
  const scope = profileThemeScope({ ...theme, glass: false });
  if (!Object.keys(scope.vars).length) return undefined;
  // Only the tokens: the dialog supplies its own bg-elevated/bg-surface class.
  return {
    ...scope.vars,
    ...(scope.colorScheme ? { colorScheme: scope.colorScheme } : {}),
  };
}
