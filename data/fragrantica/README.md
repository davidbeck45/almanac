# Fragrantica dataset

Every perfume on [Fragrantica](https://www.fragrantica.com) that has accords: names, accords, notes, season and day/night votes, longevity and sillage votes, ratings, and the season and night shares of the bottles voters say each one smells like. For well-voted bottles, also what their pages show beyond that (value for money, owners, crowd gender, popularity, perfumers, line, Fragrantica members' AI summary, smells-like and also-liked bottles), and signals derived from those votes.

Built by `scripts/decant.py` from [Fragrantica Perfumes: Ratings, Notes, Votes & More](https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes) by Le Decanteur, version and counts in `meta.json`. That dataset is licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), and so is this folder, along with `data/extras.jsonl` and the dataset-derived values in `data/*.json`: credit Le Decanteur, don't use it commercially, and share anything built from it under the same license. The perfume data itself comes from Fragrantica and its members' votes; the pros and cons are Fragrantica's AI summary of its members' reviews, quoted a few per bottle.

- `r/<id % 512>.json`: one compact row per bottle, keyed by Fragrantica id (format in `scripts/decant.py`).
- `i/<xx>.tsv`: the search index, split by the first two letters of each word of a bottle's name and brand.
- `pool.json`: the suggestion pool, about 9,600 well-voted and rising bottles, one array per key, with everything the app needs to score them and their derived signals (value, blind-buy safety, keeper rate, crowd gender lean, popular now, smells-like, cheaper alternatives, flags). It carries a `license` key, as `pool-notes.json` and `pool-styles.json` do.
- `pool-notes.json`: the pool bottles' strongest notes, row for row.
- `pool-styles.json`: each pool bottle's scent-style scores, row for row, worked out from its `r/` row by `scripts/fit-pool-styles.mjs`.
- `x/<id % 512>.json`: the about data of every bottle with 30 or more rating votes.
- `meta.json`: the dataset's version, how many bottles it holds and the shard count.
