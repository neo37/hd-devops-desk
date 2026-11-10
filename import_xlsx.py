#!/usr/bin/env python3
"""Разбор таблицы спринта (.xlsx) в строки для синхронизации доски hd.

Запуск (из hd.py): PYTHONPATH=vendor python3 import_xlsx.py <файл.xlsx> [лист]
stdout: JSON {"sheet": имя листа, "rows": [{row, n, title, desc, owner, sp, left, status, prio,
         comment, deps, super, okr, m, font}]}

Шапка ищется по ячейкам «№» и «Наименование задачи»; задачи — строки с числом в столбце A
до первой пустой. Цвет шрифта названия переносится (красный — нет в суперспринте,
синий — тех. бэклог).
"""
import json
import sys

import openpyxl


def cell(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v if isinstance(v, (int, float)) else str(v).strip()


def main():
    path = sys.argv[1]
    want = sys.argv[2] if len(sys.argv) > 2 else ''
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[want] if want in wb.sheetnames else wb.worksheets[0]
    head = None
    for row in ws.iter_rows(min_row=1, max_row=15):
        vals = [str(c.value or '').strip() for c in row[:3]]
        if vals[0] == '№' and vals[1].startswith('Наименование'):
            head = row[0].row
            break
    if head is None:
        sys.exit('не нашёл шапку таблицы (№ / Наименование задачи)')
    rows, blank = [], 0
    for row in ws.iter_rows(min_row=head + 1, max_col=13):
        v = [c.value for c in row] + [None] * 13
        num = str(v[0] or '').strip()
        if not (num.isdigit() and str(v[1] or '').strip()):
            blank += 1
            if blank >= 2 and rows:
                break
            continue
        blank = 0
        font = row[1].font.color.rgb if row[1].font and row[1].font.color and row[1].font.color.type == 'rgb' else None
        rows.append({'row': row[0].row, 'n': int(num), 'title': str(v[1]).strip(), 'desc': cell(v[2]), 'owner': cell(v[3]),
                     'sp': cell(v[4]), 'left': cell(v[5]), 'status': cell(v[6]), 'prio': cell(v[7]), 'comment': cell(v[8]),
                     'deps': cell(v[9]), 'super': cell(v[10]), 'okr': cell(v[11]), 'm': cell(v[12]), 'font': font})
    json.dump({'sheet': ws.title, 'rows': rows}, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
