Feature: Chat-event → AgentPanel adapter (live wiring)
  As the desktop renderer
  I want to fold the EXISTING chat IPC events (tool events, usage) into the
  AgentPanelState the right side-panel consumes
  So that tasks and the usage ring update live with no new IPC and no Python
  change, while staying forward-compatible with native todo/diff/review events.

  Scenario: A running tool event becomes a running task
    Given a chat tool event with callId "c1" name "terminal" status "running"
    When it is adapted to agent events
    Then there is a task.update for id "c1" in state "running"
    And the task title is "terminal"

  Scenario: A completed tool event marks the task succeeded
    Given a chat tool event with callId "c1" status "completed"
    When it is adapted
    Then the task.update state is "succeeded"

  Scenario: A failed tool event marks the task failed
    Given a chat tool event with callId "c1" status "failed"
    When it is adapted
    Then the task.update state is "failed"

  Scenario: Usage is converted to a context percentage against the window
    Given a usage event of 32768 total tokens and a context window of 131072
    When it is adapted
    Then there is a usage.update with contextPct 25

  Scenario: Context percentage is clamped to 100
    Given a usage event of 500000 total tokens and a context window of 131072
    When it is adapted
    Then the usage.update contextPct is 100

  Scenario: A native todo.update event passes through unchanged
    Given a raw agent event of type "todo.update" with one item
    When it is adapted
    Then it yields exactly that todo.update event

  Scenario: Folding adapted events updates the panel state
    Given an empty panel state
    When a running terminal tool event then a completed one are folded
    Then the panel has one task in state "succeeded"
