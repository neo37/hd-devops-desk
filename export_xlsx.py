#!/usr/bin/env python3
"""Выгрузка доски hd в Excel по шаблону исходной таблицы спринта — «один в один».

Запуск (из hd.py): PYTHONPATH=vendor python3 export_xlsx.py <шаблон.xlsx> <лист>
stdin: JSON {"rows": [{"row": 5, "B": "...", "C": ..., ...}], "extra": [{...}]}
stdout: готовый .xlsx

Строки задач пишутся в свои строки шаблона (стили, выпадающие списки, объединения и формулы
итогов сохраняются). Задачи, добавленные на доске после импорта, — в свободную строку под
таблицей, а если её нет — на лист «Добавлено на доске» с той же шапкой.
Числа итогов по волнам, вписанные в шаблон руками, пересчитываются; формулы Excel пересчитает
сам при открытии (fullCalcOnLoad).
"""
import copy
import io
import json
import sys

import openpyxl

COLS = 'BCDEFGHIJKLM'
FIRST, LAST = 3, 16          # строки задач в шаблоне
FREE = []                    # под таблицей свободных строк нет (G17:H17 объединены) — новые идут на отдельный лист


def put(ws, row, data):
    for col in COLS:
        if col in data:
            ws[f'{col}{row}'].value = data[col] if data[col] not in ('', None) else None
    if 'A' in data:
        ws[f'A{row}'].value = data['A']


def recount(ws, rows):
    """Итоги волн в шаблоне — числа, а не формулы: пересчитываем их по выгружаемым задачам."""
    def cnt(pred):
        return sum(1 for r in rows if pred(r))
    w1 = lambda r: str(r.get('H')) == '1'
    plan = {
        'H19': cnt(w1),
        'H20': cnt(lambda r: w1(r) and r.get('G') == 'Не прошло ревью'),
        'H21': cnt(lambda r: w1(r) and r.get('G') == 'Не принято в работу'),
        'H24': cnt(lambda r: not w1(r)),
        'H25': cnt(lambda r: not w1(r) and r.get('G') == 'Не прошло ревью'),
        'H26': cnt(lambda r: not w1(r) and r.get('G') == 'Не принято в работу'),
    }
    for ref, v in plan.items():
        cur = ws[ref].value
        if not (isinstance(cur, str) and cur.startswith('=')):
            ws[ref].value = v


def generic(wb, ws, data):
    """Доска без своего шаблона: формат таблицы спринта (шапка, столбцы, оформление строк),
    строки — все карточки доски, без блока итогов и выпадающих списков людей спринта."""
    row_style = {c: copy.copy(ws[f'{c}{FIRST}']._style) for c in 'A' + COLS}
    for rng in list(ws.merged_cells.ranges):
        if rng.min_row >= FIRST:
            ws.unmerge_cells(str(rng))
    ws.delete_rows(FIRST, ws.max_row)
    ws.data_validations.dataValidation = []
    ws.title = (data.get('sheet') or ws.title)[:31]
    ws['A1'].value = data.get('title') or ws['A1'].value
    for i, r in enumerate(data.get('rows', [])):
        row = FIRST + i
        for c in 'A' + COLS:
            ws[f'{c}{row}']._style = copy.copy(row_style[c])
        put(ws, row, {**r, 'A': i + 1})
    wb.calculation.fullCalcOnLoad = True
    buf = io.BytesIO()
    wb.save(buf)
    sys.stdout.buffer.write(buf.getvalue())


def main():
    tpl, sheet = sys.argv[1], sys.argv[2]
    data = json.load(sys.stdin)
    wb = openpyxl.load_workbook(tpl)
    ws = wb[sheet] if sheet in wb.sheetnames else wb.worksheets[0]
    # В книге могут быть другие листы — оставляем только лист спринта, как в исходном файле.
    for other in list(wb.worksheets):
        if other is not ws:
            wb.remove(other)
    if data.get('generic'):
        return generic(wb, ws, data)
    rows = data.get('rows', [])
    for r in rows:
        put(ws, r['row'], r)
    extra = data.get('extra', [])
    free = list(FREE)
    rest = []
    for i, r in enumerate(extra):
        if free:
            row = free.pop(0)
            src = FIRST                    # стиль берём со строки первой задачи
            for col in 'A' + COLS:
                ws[f'{col}{row}']._style = copy.copy(ws[f'{col}{src}']._style)
            put(ws, row, {**r, 'A': LAST - FIRST + 2 + i})
        else:
            rest.append(r)
    if rest:
        ns = wb.create_sheet('Добавлено на доске')
        for col in 'A' + COLS:
            ns[f'{col}1'].value = ws[f'{col}2'].value
            ns[f'{col}1']._style = copy.copy(ws[f'{col}2']._style)
            ns.column_dimensions[col].width = ws.column_dimensions[col].width
        for i, r in enumerate(rest):
            row = i + 2
            for col in 'A' + COLS:
                ns[f'{col}{row}']._style = copy.copy(ws[f'{col}{FIRST}']._style)
            put(ns, row, {**r, 'A': i + 1})
    wb.calculation.fullCalcOnLoad = True
    buf = io.BytesIO()
    wb.save(buf)
    sys.stdout.buffer.write(buf.getvalue())


if __name__ == '__main__':
    main()
