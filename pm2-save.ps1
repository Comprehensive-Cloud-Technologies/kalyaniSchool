$KeyPath = "D:\key1.pem"
$EC2_USER = "ec2-user"
$EC2_IP = "13.233.48.251"

$CMD = @'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
cd /home/ec2-user/tapneat
pm2 startup 2>/dev/null || true
pm2 save
echo "PM2 saved. Status:"
pm2 status
'@

ssh -i $KeyPath -o StrictHostKeyChecking=no "${EC2_USER}@${EC2_IP}" "$CMD"
