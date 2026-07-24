# Artwork policy

Ringside Archive does not generate imitation posters and call them original.

Artwork appears through three routes:

1. TVMaze programme or episode images.
2. A verified URL in `data/artwork-overrides.json`.
3. A clearly labelled graphic fallback using the promotion name and colour.

## Adding event artwork

Add an entry using the event or programme ID:

```json
{
  "wwe-1985-03-31-wrestlemania": {
    "url": "https://example.org/verified-original-poster.jpg",
    "sourceUrl": "https://example.org/source-page",
    "credit": "Rights holder or archive",
    "confidence": "verified"
  }
}
```

Use hotlinked images only where the host permits it. For durable deployments, store images you are legally permitted to redistribute in `artwork/` and use a relative URL such as `./artwork/wrestlemania-1985.jpg`.

Copyright remains with the respective rights holders. The repository's software licence does not grant rights to third-party imagery.
