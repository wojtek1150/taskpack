---
name: taskpack-images
description: 'Add, caption, pin and link Taskpack project images (images/images.yaml, attach_image, taskpack image add; max 5 current). Use for obraz, zdjęcie, rysunek, szkic, image, photo, sketch, pin, podpis.'
when_to_use: 'The user talks about project pictures: "dodaj to zdjęcie do witrynki", "attach this sketch", "przypnij render", "which images are current", "podpisz zdjęcie", "dodaj obraz do taska", "odepnij stary szkic", "what does the drawing show", a new file dropped into projects/<slug>/images/.'
---

# Taskpack images

Every project may have `projects/<slug>/images/` with picture files and one `images.yaml`. `images.yaml` is the only source of image metadata and of image↔task links: task files never mention images. Agents learn what a picture shows from its caption; the pinned ("current") images come with every context pack.

Answer and write captions in the workspace language (`taskpack.yaml: lang`).

## Seeing images

- MCP `get_project` / `get_task` already contain the current images (the task's images for `get_task`) as pictures, ≤ 1024 px JPEG, plus a text line per image: `[n/N] <title> — <caption> (taskpack://<project>/images/<file>)`. Pictures over the budget (`taskpack.yaml: pack.max_images`, `pack.max_image_kb`) come as `resource_link`s.
- `get_images(project, all: true)` lists every image (metadata only, cheap). To look at specific ones: `get_images(project, ids: ["<file>", …])` (max 5), or read the resource `taskpack://<project>/images/<file>`.
- Without MCP: read `images.yaml`; open a file from `images/` only when the caption is not enough. Never read `.taskpack/`.

## Adding an image

Pick the way you have:

| You are | Use |
|---|---|
| Claude Code, Codex, Cursor with the file on disk | `attach_image` with `source: { path: "/absolute/path.jpg" }`, or `{{TASKPACK}} --actor <you> image add <project> <file> …` |
| a chat app with the picture's bytes (Claude Desktop, claude.ai, ChatGPT) | `attach_image` with `source: { data_base64, mime }` (≤ 4 MB decoded) |
| a picture on the web | `attach_image` with `source: { url: "https://…" }` (public https hosts only) |
| a sketch you drew | `attach_image` with `source: { svg: "<svg …>…</svg>" }`: it is stored as SVG and rasterized for previews |

Always give `title`, `category` and a `caption`. Add `task` when the picture belongs to one task, `pin: true` only when it describes the current plan or state. Taskpack copies the file under a slugified name, appends the `images.yaml` entry with `created_by: <you>` (the gallery shows "from Claude") and makes the previews. Types: JPEG, PNG, WebP, GIF, SVG, HEIC, PDF (PDFs get a placeholder preview; HEIC only if the installed converter supports it, otherwise ask the user for a JPEG), 25 MB max.

Writing files directly (no CLI/MCP)? Copy the file into `images/` with a lowercase `a-z0-9-` name and append an entry like the one below with `created_by` and `created`. Never overwrite or delete an existing file.

## images.yaml

```yaml
images:
  - file: render-front.svg        # plain file name inside images/, must exist
    title: Render — front         # short, ≤ 200 chars
    category: visualization       # visualization | drawing | inspiration | progress | other
    caption: "Widok z przodu: dwoje drzwi przeszklonych, 3 półki, nóżki 7 cm."
    pinned: true                  # current image, sent to agents with the pack
    pinned_order: 1               # position among the current images (1 = big tile, first for agents)
    order: 1                      # display order among all images
    tasks: [drzwiczki]            # task slugs this image belongs to
    created_by: claude            # who added it
    created: 2026-09-22T21:40:00+02:00
```

Edit it in place: change one field of one entry, keep comments and the order of entries. Quote captions that contain `:` or `#`.

## Categories

| Category | For |
|---|---|
| `visualization` | renders, mockups, what it will look like |
| `drawing` | dimensioned drawings, sketches, plans, cut lists |
| `inspiration` | references and examples from elsewhere |
| `progress` | photos of the actual work at some point |
| `other` | receipts, catalogues, anything else |

## Captions

Write the caption for an agent that cannot see the picture: what it shows and the facts that matter (dimensions, materials, the choice it documents, the date for progress photos). 1–2 sentences.

## Current = pinned, at most 5

- Pin the images that describe the current plan or state; every agent gets them. Pin with `{{TASKPACK}} image pin <project>/<file>` (unpin: `image unpin`), or set `pinned` in `images.yaml`.
- A sixth pin fails ("at most 5"). First unpin the most outdated one (a rejected variant, an old progress photo) and tell the user which one.
- Unpin instead of deleting. Superseded images stay in the gallery.
- The first current image (lowest `pinned_order`) is what agents see first; the user can reorder them by dragging in the gallery.

## Linking images to tasks

Add the task slug to `tasks:` of the image entry (e.g. `tasks: [drzwiczki, polki]`), or pass `task` to `attach_image` / `--task` to `image add`. `get_task` then includes the image. Never add image references to the task file.

## A new file appeared in images/

A file in `images/` without an entry is a warning. Add an entry with `file`, a `title`, a `category`, a caption (ask the user if you cannot tell what it shows) and `pinned: false` unless the user wants it current.
