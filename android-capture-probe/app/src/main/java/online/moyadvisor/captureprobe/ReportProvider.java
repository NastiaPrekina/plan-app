package online.moyadvisor.captureprobe;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

public class ReportProvider extends ContentProvider {
    private static final String REPORT_PATH = "/report.json";
    private File reportFile() { return new File(getContext().getCacheDir(), "capture-report.json"); }
    private void checkUri(Uri uri) throws FileNotFoundException {
        if (uri == null || !REPORT_PATH.equals(uri.getPath())
            || !"online.moyadvisor.captureprobe.reports".equals(uri.getAuthority())) {
            throw new FileNotFoundException("Unknown report file");
        }
    }
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/json"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        checkUri(uri);
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only provider");
        return ParcelFileDescriptor.open(reportFile(), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        try { checkUri(uri); } catch (FileNotFoundException ex) { return null; }
        String[] cols = projection != null ? projection : new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor data = new MatrixCursor(cols);
        Object[] row = new Object[cols.length];
        for (int i=0;i<cols.length;i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i]="Advisor-Android-capture-report.json";
            if (OpenableColumns.SIZE.equals(cols[i])) row[i]=reportFile().length();
        }
        data.addRow(row);
        return data;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String where, String[] args) { return 0; }
    @Override public int delete(Uri uri, String where, String[] args) { return 0; }
}
