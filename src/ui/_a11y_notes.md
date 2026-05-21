# Accessibility Notes

## Tab Orders

### Dashboard Surface

1. TopBar Search input
2. TopBar "Add URL" button
3. TopBar Options menu
4. Sidebar Queue item
5. Sidebar Finished item
6. Sidebar Video Grabber item
7. Sidebar Logs item
8. Sidebar Settings item
9. **Main Workspace Area**
   - Active Downloads row interactions
   - If Queue is active, tab cycles over interactive specific row actions.

### Popup Surface

1. Variant selector inside Video Grabber row
2. "Download" button
3. "Open URL" outer link

### Options Surface

1. Vertical TabList
2. Internal active settings fields, forms and input ranges.
3. Save/Update action.

### Generics

- Dialogs & Drawers lock focus sequentially within the element tree containing its internal elements (using `useFocusTrap`).
- Command Palette maintains its own virtual DOM selection with active descendant, trapping focus to the `input` and shifting virtual element visibility via aria.
