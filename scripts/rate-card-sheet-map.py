#!/usr/bin/env python3
"""Read the master workbook's own layout, so nothing about it is typed.

The rate card export writes values into a COPY of the master rather than
building a sheet, which is the only way the styling, merges, column
widths, row heights, logo drawing and print area survive. To do that it
has to know which row each of the 45 rates prints on.

That is a property of the customer's file, not of this repository, so it
is read out of the file. A new master with a row inserted is picked up by
running this again and committing the result, rather than by somebody
noticing that one rate is a row out.

    python3 scripts/rate-card-sheet-map.py
"""
import json
import sys
from openpyxl import load_workbook

MASTER = 'docs/source/rate_cards/master/KNDS UK - Customer Rates 2026.xlsx'
MODEL = 'docs/source/rate_cards/rate-model.json'
OUT = 'docs/source/rate_cards/sheet-map.json'


def main() -> int:
    ws = load_workbook(MASTER)['Costing Info']
    model = json.load(open(MODEL))

    # Column B carries the item name on every priced row.
    by_name = {}
    for r in range(10, 70):
        label = ws.cell(r, 2).value
        if label and str(label).strip():
            by_name.setdefault(str(label).strip(), r)

    def row_for(item: str):
        if item in by_name:
            return by_name[item]
        # The master qualifies four labels the kit shortens, for example
        # 'HGV Lane Fee (Max per DVSA £70)'. A prefix is the match.
        for name, row in by_name.items():
            if name.startswith(item):
                return row
        return None

    rows, missing = {}, []
    for i, rate in enumerate(model['rates']):
        rid = f'r{i + 1:02d}'
        row = row_for(rate['item'].strip())
        if row is None:
            missing.append((rid, rate['item']))
        else:
            rows[rid] = row

    if missing:
        for rid, item in missing:
            print(f'  {rid}: no row in the master for "{item}"', file=sys.stderr)
        print('\n  The master and the model disagree. Fix that before exporting anything.',
              file=sys.stderr)
        return 1

    # Row 10 names the columns, so which letter is which is read too.
    header = {str(ws.cell(10, c).value or '').strip(): ws.cell(10, c).column_letter
              for c in range(3, 10)}
    columns = {
        'single': header.get('Price', 'C'),
        'axle': [header.get(f'{n}-axle', chr(ord('D') + n - 1)) for n in (1, 2, 3, 4)],
    }

    json.dump({'rows': rows, 'columns': columns}, open(OUT, 'w'), indent=2)
    print(f'  {len(rows)} rates mapped to rows, columns {columns["single"]} '
          f'and {"".join(columns["axle"])}, written to {OUT}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
