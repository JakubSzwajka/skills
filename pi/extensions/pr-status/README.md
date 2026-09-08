# PR status

Adds the current branch's GitHub pull request to Pi's footer.

```text
◇ rocket #41 draft
● rocket #42 active
◆ rocket #43 merged
× rocket #44 closed
```

Draft and closed are muted, active is green, and merged uses the theme accent. The extension shows nothing when the branch has no pull request or `gh` cannot resolve one.

Run `/gh:pr:open` to open the current branch's pull request in Brave Browser. The command warns when the branch has no pull request and reports an error when Brave cannot open.

The footer refreshes when a Pi session starts and after each agent run. Pi already loads this extension from `~/.agents/pi/extensions`; run `/reload` after changing it.
