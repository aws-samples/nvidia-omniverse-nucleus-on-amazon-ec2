#!/bin/bash

echo "------------------------ NUCLEUS SERVER CONFIG ------------------------"
echo "UPDATING AND INSTALLING DEPS ----------------------------------"
sudo apt-get update -y -q && sudo apt-get upgrade -y
sudo apt-get install dialog apt-utils -y

echo "INSTALLING AWS CLI ----------------------------------"
sudo curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
sudo apt-get install unzip
sudo unzip awscliv2.zip
sudo ./aws/install
sudo rm awscliv2.zip
sudo rm -fr ./aws/install

echo "INSTALLING PYTHON ----------------------------------"
sudo apt-get -y install python3.9
sudo curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
sudo python3.9 get-pip.py

echo "INSTALLING DOCKER ----------------------------------"
sudo apt-get remove docker docker-engine docker.io containerd runc
sudo apt-get -y install apt-transport-https ca-certificates curl gnupg-agent software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
sudo apt-get -y update
sudo apt-get -y install docker-ce docker-ce-cli containerd.io
sudo systemctl enable --now docker

echo "INSTALLING DOCKER COMPOSE ----------------------------------"
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose