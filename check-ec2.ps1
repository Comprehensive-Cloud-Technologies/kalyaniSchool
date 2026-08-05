$KeyPath = "D:\key1.pem"
$EC2_USER = "ec2-user"
$EC2_IP = "13.233.48.251"

$CHECK = @'
pm2 status
echo "---"
curl -sf http://localhost:5000/api/health && echo "BACKEND_OK" || echo "BACKEND_FAILED"
echo "---"
curl -sf http://localhost:80/api/health && echo "NGINX_OK" || echo "NGINX_FAILED"
'@

ssh -i $KeyPath -o StrictHostKeyChecking=no "${EC2_USER}@${EC2_IP}" "$CHECK"
