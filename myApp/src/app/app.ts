import { Component, OnInit, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';

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

  constructor(private zone: NgZone, private cd: ChangeDetectorRef) {}

  ngOnInit() {
    const savedIp = localStorage.getItem('serverIp');
    if (savedIp) {
      this.ipAddress = savedIp;
      this.isIpSet = true;
    }
  }

  setIp() {
    if (this.ipAddress.trim() !== '') {
      localStorage.setItem('serverIp', this.ipAddress);
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
    localStorage.removeItem('serverIp');
    this.isIpSet = false;
    this.ipAddress = '';
    this.scanResult = '';
  }

  rescan() {
  this.scanResult = '';
  this.scanQR();
}
}