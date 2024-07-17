# Change Log

All notable changes to the "code-explorer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 0.3.4

- Show gray gutter for not active marker
- Add reveal marker menu for gutter

## 0.3.3

- Rename data file without heading dot

## 0.3.2

- Save relative file path of marker
- Expose select marker command

## 0.3.1

- Add gutter context menu to add/delete marker

## 0.3.0

- Add marker at the end of stack, not at the head
- Add Reverse Markers command
- Add indent/unindent for markers
- Show gutter icon decoration for marker line

## 0.2.2

- Add copyMarkersReversed command
- Fix not expanding active stack tree node when activating

## 0.2.1

- Support multiple folders workspace

## 0.2.0

- Show all stacks in the panel

## 0.1.16

- Support icon set on a marker

## 0.1.15

- Support title set on a marker

## 0.1.14

- Support tags on a marker

## 0.1.13

- Optimize data fields

## 0.1.12

- Save data file into workspace .vscode dir

## 0.1.11

- Add `Open Data File` command
- Rename some commands
- Add copy markers commands
- Optimize watching muting
- Group markers of same stack together in the data file
- Avoid reloading data by watcher when first activated

## 0.1.10

- Create data file automatically when not found

## 0.1.9

- Watch data file(create/change/delete) to reload data automatically
- Allow filter on description when running select marker commands

## 0.1.8

- Use UUID as marker and stack id
- Add `Select a Marker of Current Stack` and `Select a Marker of All Stacks` commands

## 0.1.7

- Support drag and drop in stack view
- Add .actions command to gather actions like rename/remove
- Prompt current stack in switch input box

## 0.1.0

- Initial release
