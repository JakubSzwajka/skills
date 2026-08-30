---
name: ryan-review
description: Review code for correctness, test coverage, error handling, performance, security, DRY principles, and SOLID principles.
---

### Review Process — Single Thorough Pass

Do ONE comprehensive pass that catches everything. Do not report early surface-level findings and defer deeper analysis to later rounds — that creates an endless review cycle where each fix-up review surfaces issues that should have been caught the first time.

For each file changed in the PR:
1. Read the full diff carefully, line by line
2. For each code block (function, class, config stanza), systematically apply ALL 9 criteria below before moving to the next block
3. Cross-reference code blocks against each other for consistency, duplication, and integration issues
4. After reviewing all files, do a second mental pass across the full changeset looking for cross-cutting concerns (naming consistency, shared patterns, architectural coherence)

Only produce your output after completing the full analysis. For each file changed in the PR, review the code against the following criteria:

### 1. Correctness of Solution
- Does the code correctly implement the intended functionality?
- Are there any logic errors or edge cases not handled?
- Does the implementation match the PR description and any linked issues?

### 2. Test Coverage
- Are there adequate unit tests for new functionality?
- Do tests cover edge cases and error conditions?
- Are existing tests updated if behavior changed?
- Is test coverage appropriate for the complexity of the changes?

### 3. Error Handling
- Are errors properly caught and handled?
- Are error messages clear and actionable?
- Is there appropriate logging for debugging?
- Are async operations properly handling rejections?

### 4. Code Optimization
- Is the code unnecessarily complex?
- Are there redundant operations or repeated calculations?
- Could any loops or iterations be simplified?
- Are data structures appropriate for the use case?

### 5. Codebase Pattern Consistency
- Does the code follow existing patterns in the codebase?
- Are naming conventions consistent with the rest of the project?
- Does it follow the project's architectural patterns (domain-driven design, etc.)?
- Is the file/folder structure appropriate per project conventions?

### 6. Performance Efficiency
- Are there potential performance bottlenecks?
- Are expensive operations (API calls, database queries) minimized?
- Is memoization or caching used where appropriate?
- Are there potential memory leaks (subscriptions, event listeners)?

### 7. Security
- Is user input properly validated and sanitized?
- Are there any potential injection vulnerabilities (SQL, XSS, command)?
- Are secrets/credentials properly handled (not hardcoded)?
- Are authentication/authorization checks in place where needed?

### 8. DRY (Don't Repeat Yourself)
- Is there duplicated code that could be extracted?
- Are there existing utilities or helpers that could be reused?
- Could shared logic be abstracted into a common function or hook?

### 9. SOLID Principles
- **Single Responsibility**: Does each class/function have one clear purpose?
- **Open/Closed**: Is code open for extension but closed for modification?
- **Liskov Substitution**: Do derived types properly substitute base types?
- **Interface Segregation**: Are interfaces focused and not bloated?
- **Dependency Inversion**: Are dependencies properly abstracted?

## Output Format

Provide a structured review with:

1. **Summary**: Brief overview of what the PR does and overall assessment
2. **Strengths**: What the PR does well
3. **Issues Found**: Categorized by severity (Critical, Major, Minor, Suggestion)
4. **Specific File Feedback**: Detailed comments for each file with line references
5. **Recommendations**: Actionable suggestions for improvement

Use this format for issues:
```
**[SEVERITY]** `filename:line` - Description of issue
  - Suggestion: How to fix it
```

Be thorough but constructive. Focus on helping improve the code quality while acknowledging good practices.