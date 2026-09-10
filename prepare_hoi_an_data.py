from pathlib import Path
import json
import math
import pandas as pd

downloads = Path('/Users/congthiendev/Downloads')
output = Path('/Users/congthiendev/Documents/GG_Map_Scraper_Email_PhoneNumber/outputs/hoi_an_merged/source_data.json')
source_files = [
    'Hoi_An_food.xlsx', 'Hoi_An_BBQ.xlsx', 'Hoi_An_car.xlsx', 'Hoi_An_transfer.xlsx',
    'Hoi_An_photographer.xlsx', 'Hoi_An_wedding.xlsx', 'Hoi_An_cooking_class (2).xlsx',
    'Hoi_An_basket_boat.xlsx', 'Hoi_An_pizza.xlsx', 'Hoi_An_fine_dining_Hoi_An.xlsx',
    'Hoi_An_best_restaurant.xlsx', 'Hoi_An_villa_Hoi_An.xlsx', 'Hoi_An_Coffee_shop (1).xlsx',
    'Hoi_An_cooking_class (1).xlsx', 'Hoi_An_homestay (1).xlsx', 'Hoi_An_villa (1).xlsx',
    'Hoi_An_nails (1).xlsx', 'Hoi_An_hotel (1).xlsx', 'Hoi_An_massage (1).xlsx',
    'Hoi_An_tailor (1).xlsx', 'Hoi_An_coffee (1).xlsx', 'Hoi_An_Restaurants (1).xlsx',
    'Hoi_An_villa.xlsx', 'Hoi_An_homestay.xlsx', 'Hoi_An_cooking_class.xlsx',
    'Hoi_An_Coffee_shop.xlsx', 'Hoi_An_nails.xlsx', 'Hoi_An_hotel.xlsx',
    'Hoi_An_massage.xlsx', 'Hoi_An_tailor.xlsx', 'Hoi_An_coffee.xlsx', 'Hoi_An_Restaurants.xlsx',
]

def native(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ''
    if hasattr(value, 'item'):
        value = value.item()
    return value

sources = []
for file_name in source_files:
    workbook = pd.ExcelFile(downloads / file_name)
    sheet = 'Leads' if 'Leads' in workbook.sheet_names else 'data'
    data = pd.read_excel(downloads / file_name, sheet_name=sheet, dtype=object)
    records = [{key: native(value) for key, value in row.items()} for row in data.to_dict(orient='records')]
    sources.append({'fileName': file_name, 'records': records})

output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(sources, ensure_ascii=False), encoding='utf-8')
print(f'Wrote {len(sources)} sources and {sum(len(s["records"]) for s in sources)} rows')
