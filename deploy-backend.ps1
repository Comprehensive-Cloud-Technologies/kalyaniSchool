$KeyPath  = "C:\Users\Archit Kore\Downloads\key1.pem"
$EC2_IP   = "13.233.48.251"
$EC2_USER = "ec2-user"
$BACKEND  = "D:\projects\K_school\kalyaniSchool\Tap-N-Eat\backend-node"

# Fix key permissions
icacls $KeyPath /inheritance:r /grant:r "${env:USERNAME}:(R)" 2>$null

Write-Host "`n==> Uploading backend-node to /home/ec2-user/tapneat/ ..."
scp -i $KeyPath -o StrictHostKeyChecking=no -r "$BACKEND\*" "${EC2_USER}@${EC2_IP}:/home/ec2-user/tapneat/"

Write-Host "`n==> Running remote setup on EC2 ..."
$REMOTE = @'
set -e
echo "--- Installing npm deps ---"
cd /home/ec2-user/tapneat
npm install --omit=dev

echo "--- Stopping old PM2 process (if any) ---"
pm2 stop tapneat-api 2>/dev/null || true
pm2 delete tapneat-api 2>/dev/null || true

echo "--- Starting backend with PM2 ---"
pm2 start ecosystem.config.json
pm2 save

echo "--- Applying Nginx config ---"
sudo cp /home/ec2-user/tapneat/tapneat.nginx.conf /etc/nginx/sites-available/tapneat
sudo ln -sf /etc/nginx/sites-available/tapneat /etc/nginx/sites-enabled/tapneat
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "--- Health check ---"
sleep 3
curl -sf http://localhost:5000/api/health && echo " => BACKEND OK" || echo " => BACKEND FAILED - check: pm2 logs tapneat-api"

echo "--- PM2 status ---"
pm2 status

echo ""
echo "============================================================"
echo " Deployment complete!  http://13.233.48.251/api/health"
echo "============================================================"
'@

ssh -i $KeyPath -o StrictHostKeyChecking=no "${EC2_USER}@${EC2_IP}" "$REMOTE"
