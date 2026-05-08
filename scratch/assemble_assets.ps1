$p1 = Get-Content 'g:\Projects\el-serrucho-go\assets\logo_p1.txt' -Raw
$p2 = Get-Content 'g:\Projects\el-serrucho-go\assets\logo_p2.txt' -Raw
$p3 = Get-Content 'g:\Projects\el-serrucho-go\assets\logo_p3.txt' -Raw
$logo = "export const SERRUCHO_LOGO = 'data:image/png;base64," + $p1 + $p2 + $p3 + "';"
$logo | Set-Content 'g:\Projects\el-serrucho-go\src\constants\pdfAssets.ts' -NoNewline
