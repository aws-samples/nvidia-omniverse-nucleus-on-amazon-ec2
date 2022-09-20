from setuptools import setup

with open("README.md", "r") as fh:
    long_description = fh.read()

setup(
    name="Omniverse Nucleus Deployment Tools",
    version="1.0",
    py_modules=["ondt"],
    install_requires=["boto3", "python-dotenv", "Click"],
    entry_points="""
        [console_scripts]
        ondt=ondt_cli:main
    """,
)
