Feature: Design-token contrast contract (Phase 6 — aesthetic finish)
  As the desktop design system
  I want a canonical token registry plus pure WCAG contrast math
  So that the new panes (DiffView, RightPanel) use defined tokens only and
  every text/background pair meets accessibility contrast in both themes.

  # --- WCAG contrast math ---
  Scenario: Black on white has the maximum contrast ratio
    Given foreground "#000000" and background "#ffffff"
    Then the contrast ratio is 21

  Scenario: Pure white has relative luminance 1
    Given the colour "#ffffff"
    Then its relative luminance is 1

  Scenario: Pure black has relative luminance 0
    Given the colour "#000000"
    Then its relative luminance is 0

  Scenario: Three-digit hex is parsed like six-digit hex
    Given foreground "#fff" and background "#000"
    Then the contrast ratio is 21

  # --- token registry completeness ---
  Scenario: Every design token defines both a light and a dark value
    Given the design-token registry
    Then every token has a non-empty light value
    And every token has a non-empty dark value

  # --- drift guard ---
  Scenario: missingTokens flags a CSS var with no registry entry
    Given the used CSS vars include a known token and "--not-a-real-token"
    When I compute missing tokens
    Then "--not-a-real-token" is reported missing
    And the known token is not reported

  # --- contrast report ---
  Scenario: The contrast report returns one row per declared UI pair
    Given the declared UI foreground/background pairs
    When I build the contrast report
    Then there is one row per pair
    And each row has a light and a dark result

  Scenario: A primary text pair passes AA in both themes
    Given the primary text on base-background pair
    Then it passes AA contrast in the light theme
    And it passes AA contrast in the dark theme

  Scenario: The report flags any pair that fails AA in either theme
    Given a pair that is low-contrast in at least one theme
    Then the report marks that pair as failing AA
