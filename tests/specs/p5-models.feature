Feature: P5 models — deep links, CI status, @mention (Phase 5)
  Pure logic for launching sessions from a URL, summarizing CI for the status
  bar (auto-fix/auto-merge gating), and @mention file autocomplete.

  # --- deep links (hermes://open) ---
  Scenario: A valid deep link parses cwd, repo and a decoded prompt
    Given the link "hermes://open?cwd=/home/me/app&repo=acme/api&q=fix%20the%20deploy%0Acheck%20logs"
    When it is parsed
    Then it is ok with action "open"
    And cwd is "/home/me/app"
    And repo is "acme/api"
    And the prompt contains a newline between "deploy" and "check"

  Scenario: A non-hermes scheme is rejected
    Given the link "https://evil.example.com/open?q=x"
    When it is parsed
    Then it is rejected

  Scenario: A UNC or network cwd is rejected
    Given a hermes link whose cwd is a UNC path
    When it is parsed
    Then it is rejected

  Scenario: A malformed repo (not owner/name) is rejected
    Given a hermes link with repo "not-a-repo"
    When it is parsed
    Then it is rejected

  Scenario: A prompt longer than 5000 characters is rejected
    Given a hermes link whose q decodes to 6000 characters
    When it is parsed
    Then it is rejected

  # --- CI status ---
  Scenario: All completed successes summarise as passing
    Given CI checks all completed with success
    Then the CI state is "passing"

  Scenario: Any failure summarises as failing
    Given CI checks where one completed with failure
    Then the CI state is "failing"

  Scenario: Any incomplete check summarises as pending
    Given CI checks where one is still in_progress
    Then the CI state is "pending"

  Scenario: Auto-merge is allowed only when passing and enabled
    Given a passing CI summary
    Then auto-merge is allowed when enabled
    And auto-merge is not allowed when disabled
    And auto-merge is not allowed when the summary is failing

  Scenario: Auto-fix runs only when failing and enabled
    Given a failing CI summary
    Then auto-fix runs when enabled
    And auto-fix does not run when the summary is passing

  # --- @mention autocomplete ---
  Scenario: A mention is active mid "@foo"
    Given the text "see @comp" with the caret at the end
    When the mention query is parsed
    Then a mention is active with query "comp"

  Scenario: A mention is not active after a space
    Given the text "see @comp done" with the caret at the end
    Then no mention is active

  Scenario: Candidate filtering ranks prefix matches before substring matches
    Given files "components/Button.tsx" and "src/MyComp.tsx" and "x/comp.ts"
    When filtered by "comp"
    Then a prefix match appears before a mid-path substring match
