import { Component, OnInit ,PLATFORM_ID, Inject, NgZone, ChangeDetectorRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BarcodeScanner, LensFacing } from '@capacitor-mlkit/barcode-scanning';
import { isPlatformBrowser, } from '@angular/common';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {

  ipAddress: string = '';
  isIpSet: boolean = false;
  scanResult: string = '';

  constructor(@Inject(PLATFORM_ID) private platformId: Object, private zone: NgZone, private cd: ChangeDetectorRef) {}

  ngOnInit() {
    // Check if IP was already saved previously
    if (isPlatformBrowser(this.platformId)) {
      const savedIp = localStorage.getItem('serverIp');
      if (savedIp) {
        this.ipAddress = savedIp;
        this.isIpSet = true;
      }
    }
  }

  setIp() {
    if (this.ipAddress.trim() !== '') {
      // Check again before saving
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('serverIp', this.ipAddress);
      }
      this.isIpSet = true;
    } else {
      alert('Please enter IP Address');
    }
  }

async scanQR() {
  try {

    const permission = await BarcodeScanner.requestPermissions();
    if (permission.camera !== 'granted') {
      alert('Camera permission denied');
      return;
    }

    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();

    if (!available) {
      alert('Scanner module missing. Downloading now... please wait 10 seconds and try again.');
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      return;
    }

    const result = await BarcodeScanner.scan();

    if (result.barcodes.length > 0) {

      const value = result.barcodes[0].rawValue!;

      this.zone.run(() => {
        this.scanResult = value;
        this.cd.detectChanges();
      });

      await BarcodeScanner.stopScan();
    }

  } catch (error) {
    console.error('Scan Error:', error);
    alert('Scanning failed. Make sure Google Play Services is updated.');
  }
}


  resetIp() {
    this.isIpSet = false;
    this.scanResult = '';
  }

  rescan() {
  this.scanResult = '';
  this.scanQR();
}
}