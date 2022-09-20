import os

import boto3
import botocore

from . import logger

client = boto3.client('ec2')

def associate_enclave_certificate_iam_role(cert_arn, role_arn):

    response = client.associate_enclave_certificate_iam_role(
        CertificateArn=cert_arn,
        RoleArn=role_arn
    )

    return response

def disassociate_enclave_certificate_iam_role(cert_arn, role_arn):

    response = client.disassociate_enclave_certificate_iam_role(
        CertificateArn=cert_arn,
        RoleArn=role_arn
    )

    return response

def get_associated_enclave_certificate_iam_roles(cert_arn):
    response = client.get_associated_enclave_certificate_iam_roles(
        CertificateArn=cert_arn
    )

    return response

def create_ami_from_instance(instance_id, ami_name, storage_size=512):

    # get instance root volume
    response = client.describe_instances(InstanceIds=[instance_id])
    instances = response['Reservations'][0]['Instances']

    if not instances:
        logger.warning(f'No instances exist with {instance_id=}')
        return None
    instance = instances[0]

    instance_name = 'Empty Name'
    for tag in instance['Tags']:
        if tag['Key'] == 'Name':
            instance_name = tag['Value']

    rootDeviceName = instance['RootDeviceName']
    rootVolumeId = None
    for blockDeviceMapping in instance['BlockDeviceMappings']:
        if blockDeviceMapping['DeviceName'] == rootDeviceName:
            rootVolumeId = blockDeviceMapping['Ebs']['VolumeId']

    logger.info(f'Found {rootVolumeId=}')
    logger.info(f'Creating Snapshot ... ')
    # create snap of volume
    snap = client.create_snapshot(VolumeId=rootVolumeId)
    snap_id = snap['SnapshotId']
    snap_waiter = client.get_waiter('snapshot_completed')

    try:
        snap_waiter.wait(SnapshotIds=[snap_id], WaiterConfig={'Delay': 15,'MaxAttempts': 59 })
    except botocore.exceptions.WaiterError as e:
        logger.warning("Could not create snapshot, aborting")
        logger.warning(e.message)
        return

    logger.info("Created snapshot: {}".format(snap['SnapshotId']))

    # tag snap shot
    client.create_tags(
            Resources=[snap['SnapshotId']],
            Tags=[
                {'Key': 'Name', 'Value': "Snapshot of " + instance_name}
            ]
        )

    # delete existing amis
    images = client.describe_images(Owners=['self'])['Images']
    for ami in images:
        if ami['Name'] == ami_name:
            logger.info('Deleting image {}'.format(ami['ImageId']))
            client.deregister_image(DryRun=False,ImageId=ami['ImageId'])

    # create and tag ami
    ami = client.register_image(
            Name=ami_name,
            Description=ami_name + ' Automatic AMI',
            BlockDeviceMappings=[
                {
                    'DeviceName': rootDeviceName,
                    'Ebs': {
                        'DeleteOnTermination': True,
                        'SnapshotId': snap['SnapshotId'],
                        'VolumeSize': storage_size,
                        'VolumeType': 'gp2'
                    }
                },
            ],
            Architecture='x86_64',
            RootDeviceName='/dev/sda1',
            DryRun=False,
            VirtualizationType='hvm'
        )
    logger.info('Created image {}'.format(ami['ImageId']))

    # Tag the AMI
    client.create_tags(
        Resources=[ami['ImageId']],
        Tags=[
            {'Key': 'Name', 'Value': ami_name}
        ]
    )

    # delete snapshot
    previous_snapshots = client.describe_snapshots(OwnerIds=['self'])['Snapshots']
    for snapshot in previous_snapshots:

        is_ami_snapshot = False
        for tag in snapshot['Tags']:
            if tag['Value'] == f'Snapshot of {ami_name}' and snapshot['SnapshotId'] != snap['SnapshotId']:
                is_ami_snapshot = True

        if is_ami_snapshot and snapshot['SnapshotId'] != snap['SnapshotId']:
            print("Removing previous snapshot: {}".format(snapshot['SnapshotId']))
            client.delete_snapshot(SnapshotId=snapshot['SnapshotId'])

    return ami
