"""Print name / price / stock (and variants) for one or more GetFPV product URLs.

    python scripts/getfpv_offer.py https://www.getfpv.com/some-product.html [...]
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpvdata  # noqa: E402

fpvdata.utf8_stdout()
for url in sys.argv[1:]:
    outcome, offer = fpvdata.fetch_getfpv_offer(url, retries=2)
    print(json.dumps({"url": url, "outcome": outcome, **(offer or {})}, ensure_ascii=False))
