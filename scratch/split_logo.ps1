$c = Get-Content 'g:\Projects\el-serrucho-go\assets\logo_base64.txt' -Raw
$c.Substring(0, 30000) | Set-Content 'g:\Projects\el-serrucho-go\assets\logo_p1.txt' -NoNewline
$c.Substring(30000, 30000) | Set-Content 'g:\Projects\el-serrucho-go\assets\logo_p2.txt' -NoNewline
$c.Substring(60000) | Set-Content 'g:\Projects\el-serrucho-go\assets\logo_p3.txt' -NoNewline
