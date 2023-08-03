
def start_nucleus_config() -> list[str]:
    return '''
        cd /opt/ove/base_stack || exit 1
        echo "STARTING NUCLEUS STACK ----------------------------------"
        docker-compose --env-file nucleus-stack.env -f nucleus-stack-ssl.yml start
    '''.splitlines()


def stop_nucleus_config() -> list[str]:
    return '''
        cd /opt/ove/base_stack || exit 1
        echo "STOPPING NUCLEUS STACK ----------------------------------"
        docker-compose --env-file nucleus-stack.env -f nucleus-stack-ssl.yml stop
    '''.splitlines()


def restart_nucleus_config() -> list[str]:
    return '''
        cd /opt/ove/base_stack || exit 1
        echo "RESTARTING NUCLEUS STACK ----------------------------------"
        docker-compose --env-file nucleus-stack.env -f nucleus-stack-ssl.yml restart
    '''.splitlines()


def get_config(artifacts_bucket_name: str, full_domain: str, nucleus_build: str, ov_main_password: str, ov_service_password: str) -> list[str]:
    return f'''
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
        sudo pip3 install --upgrade pip
        sudo pip3 --version

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

        echo "INSTALLING NUCLEUS TOOLS ----------------------------------"
        sudo mkdir -p /opt/ove
        cd /opt/ove || exit 1
        aws s3 cp --recursive s3://{artifacts_bucket_name}/tools/nucleusServer/ ./nucleusServer
        cd nucleusServer || exit 1
        sudo pip3 install -r requirements.txt

        echo "UNPACKAGING NUCLEUS STACK ----------------------------------"
        sudo tar xzvf stack/{nucleus_build}.tar.gz -C /opt/ove --strip-components=1
        cd /opt/ove/base_stack || exit 1
        omniverse_data_path=/var/lib/omni/nucleus-data
        nucleusHost=$(curl -s http://169.254.169.254/latest/meta-data/hostname)
        sudo nst generate-nucleus-stack-env --server-ip $nucleusHost --reverse-proxy-domain {full_domain} --instance-name nucleus_server --master-password {ov_main_password} --service-password {ov_service_password} --data-root $omniverse_data_path
        chmod +x ./generate-sample-insecure-secrets.sh
        ./generate-sample-insecure-secrets.sh

        echo "PULLING NUCLEUS IMAGES ----------------------------------"
        docker-compose --env-file nucleus-stack.env -f nucleus-stack-ssl.yml pull

        echo "STARTING NUCLEUS STACK ----------------------------------"
        docker-compose --env-file nucleus-stack.env -f nucleus-stack-ssl.yml up -d
        docker-compose --env-file nucleus-stack.env -f nucleus-stack-ssl.yml ps -a
    '''.splitlines()
