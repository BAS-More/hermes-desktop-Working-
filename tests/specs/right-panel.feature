Feature: Right side-panel + always-visible auto-ticking to-do (Phase 3)
  As the desktop user
  I want a right-hand panel whose to-do list auto-ticks as the agent works
  So that I can see progress, plan, tasks, diffs, review and usage at a glance,
  all driven by one AgentPanelState with no separate pipeline.

  # --- panel-layout pure state ---
  Scenario: The panel defaults to visible with the todo section active
    When I read the default right-panel state
    Then the panel is visible
    And the active section is "todo"

  Scenario: Toggling the panel hides and shows it
    Given the default right-panel state
    When I toggle the panel
    Then the panel is hidden
    When I toggle the panel again
    Then the panel is visible

  Scenario: Switching the active section
    Given the default right-panel state
    When I set the active section to "usage"
    Then the active section is "usage"

  Scenario: Collapsing a section persists in state
    Given the default right-panel state
    When I toggle the "plan" section
    Then "plan" is collapsed
    When I toggle the "plan" section again
    Then "plan" is not collapsed

  # --- always-visible todo progress selector ---
  Scenario: Empty todo shows 0 of 0 and 0 percent
    Given an agent panel state with no todo items
    Then todo progress is 0 done of 0 total at 0 percent

  Scenario: Todo progress counts completed items
    Given an agent panel with 5 todo items, 2 completed
    Then todo progress is 2 done of 5 total at 40 percent

  Scenario: An all-completed todo list shows 100 percent
    Given an agent panel where every todo item is completed
    Then todo progress pct is 100

  # --- live UI behavior ---
  Scenario: A todo item completing increments the done count live
    Given the right panel rendered with item "t1" in_progress
    When the agent emits a todo.update marking "t1" completed
    Then the rendered todo header shows one more completed item
    And item "t1" renders as checked

  Scenario: The usage ring reflects context and plan percentages
    Given the right panel rendered with usage contextPct 42 and planPct 17
    Then the usage section shows 42 percent context and 17 percent plan

  # --- robustness / a11y ---
  Scenario: The todo list keeps stable row identity across a full-list replace
    Given the panel rendered with items "a,b,c"
    When the agent replaces the list with "a,b" (c removed)
    Then rows "a" and "b" keep their DOM identity (no flicker)
    And row "c" is gone

  Scenario: The todo checklist exposes a live-region role for screen readers
    Given the right panel rendered with a todo list
    Then the checklist container has an accessible list role
    And it announces updates politely
