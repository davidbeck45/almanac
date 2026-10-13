# Fragrantica dataset

Every perfume on [Fragrantica](https://www.fragrantica.com) that has accords: names, accords, notes, season and day/night votes, longevity and sillage votes, ratings, and the season and night shares of the bottles voters say each one smells like.

Built by `scripts/decant.py` from [Fragrantica Perfumes: Ratings, Notes, Votes & More](https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes) by Le Decanteur, version and counts in `meta.json`. That dataset is licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), and so is this folder: credit Le Decanteur, don't use it commercially, and share anything built from it under the same license. The perfume data itself comes from Fragrantica and its members' votes.

- `r/<id % 512>.json`: one compact row per bottle, keyed by Fragrantica id (format in `scripts/decant.py`).
- `i/<xx>.tsv`: the search index, split by the first two letters of each word of a bottle's name and brand.
