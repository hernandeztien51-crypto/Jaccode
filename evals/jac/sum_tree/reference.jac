node Folder {
    has name: str;
    has size: int = 0;
}

walker TotalSize {
    has total: int = 0;

    can add with Folder entry {
        self.total += here.size;
        visit [-->];
    }
}
