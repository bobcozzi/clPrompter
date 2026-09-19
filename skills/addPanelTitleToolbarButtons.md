# VS Code Native Toolbar / View-Title Menu Troubleshooting

## Purpose
Use native VS Code contribution points instead of custom Quick Picks, fake commands, or webview workarounds when the user wants a Terminal/Output-style menu in a view title.

The goal is the smallest correct fix to `package.json` while preserving VS Code's native behavior.

## Core Rules

### 1. Prefer native VS Code UI
Use:
- `contributes.submenus`
- `menus.view/title`
- `when` clauses
- `group`
- native menu behavior

Do not replace a native submenu with a Quick Pick or custom popup unless the user explicitly asks for that.

### 2. Understand where properties belong
The manifest has strict ownership rules.

This is the critical pattern:

```json
"submenus": [
  {
    "id": "myExtension.settingsMenu",
    "label": "Settings",
    "icon": "$(ellipsis)"
  }
]
```

Then in `menus.view/title`:

```json
{
  "submenu": "myExtension.settingsMenu",
  "when": "view == myExtension.myView",
  "group": "navigation@3"
}
```

Do not put the `icon` on the `view/title` submenu reference. The `icon` belongs to the submenu definition, not to the menu item that references it.

### 3. Preserve working behavior
If the menu opens and functions correctly, do not replace it with a command, a Quick Pick, or a fake `...` command.

If the only issue is a blank title-bar icon, inspect the manifest structure before changing TypeScript.

### 4. Fix the smallest layer
When debugging a visual issue in a native menu:
1. Identify whether it is a view-title element.
2. Find the corresponding `contributes` item in `package.json`.
3. Verify the schema and where the property belongs.
4. Apply one exact manifest fix.
5. Only inspect TypeScript if the contribution itself is correct and behavior still fails.

## Good vs Bad Example

Correct:

```json
"submenus": [
  {
    "id": "myExtension.settingsMenu",
    "label": "Settings",
    "icon": "$(ellipsis)"
  }
],
"menus": {
  "view/title": [
    {
      "submenu": "myExtension.settingsMenu",
      "when": "view == myExtension.myView",
      "group": "navigation@3"
    }
  ]
}
```

Incorrect:

```json
{
  "submenu": "myExtension.settingsMenu",
  "title": "...",
  "icon": "$(ellipsis)",
  "when": "view == myExtension.myView",
  "group": "navigation@3"
}
```

The `icon` should be attached to the submenu definition, not the `view/title` item.

## Short Agent Prompt
If another agent needs this, give them this:

> Fix the native VS Code title-bar submenu, not a Quick Pick or fake command. Keep the existing submenu behavior. Verify the submenu is contributed through `contributes.submenus` and referenced from `menus.view/title` via `"submenu": "..."`. Do not turn it into a command or a title with `...`. If the icon is blank, inspect the manifest ownership and move the `icon` to the submenu definition, not the `view/title` menu item. Preserve the working native submenu behavior.

## Important Principle
For VS Code extension UI, the contribution schema is the source of truth. If the element is present but visually wrong, check the manifest structure before changing the implementation.