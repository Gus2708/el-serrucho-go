import os

file_path = r'g:\Projects\el-serrucho-go\src\constants\pdfAssets.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read().strip()

if not content.endswith(';'):
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content + ';')
    print("Added semicolon.")
else:
    print("Semicolon already exists.")
