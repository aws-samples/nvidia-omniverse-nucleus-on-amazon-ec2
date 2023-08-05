def get_config(artifacts_bucket_name: str, nucleus_address: str, full_domain: str) -> list[str]:
    return f'''
        echo "------------------------ REVERSE PROXY CONFIG ------------------------"

        echo "UPDATING PACKAGES ----------------------------------"
        sudo yum update -y

        echo "INSTALLING DEPENDENCIES ----------------------------------"
        sudo yum install -y aws-cfn-bootstrap gcc openssl-devel bzip2-devel libffi-devel zlib-devel

        echo "INSTALLING NGINX ----------------------------------"
        sudo yum install -y amazon-linux-extras
        sudo amazon-linux-extras enable nginx1
        sudo yum install -y nginx
        sudo nginx -v

        echo "INSTALLING PYTHON ----------------------------------"
        sudo wget https://www.python.org/ftp/python/3.9.9/Python-3.9.9.tgz -P /opt/python3.9
        cd /opt/python3.9 || exit 1
        sudo tar xzf Python-3.9.9.tgz
        cd Python-3.9.9 || exit 1
        sudo ./configure --prefix=/usr --enable-optimizations
        sudo make install
        pip3 --version
        
        echo "INSTALLING REVERSE PROXY TOOLS ----------------------------------"
        cd /opt || exit 1
        sudo aws s3 cp --recursive s3://{artifacts_bucket_name}/tools/reverseProxy/ ./reverseProxy
        cd reverseProxy || exit 1
        sudo pip3 install -r requirements.txt
        sudo rpt generate-nginx-config --domain {full_domain} --server-address {nucleus_address}

        echo "STARTING NGINX ----------------------------------"
        sudo service nginx restart
    '''.splitlines()
